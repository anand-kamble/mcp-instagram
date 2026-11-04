/**
 * Session manager for the Instagram client.
 *
 * Owns the single InstagramClient the tools use: restores the saved session,
 * logs in, and logs out. Instagram traffic goes through src/instagram (our own
 * private-API client); this module keeps the public methods the tools and the
 * startup code call.
 */

import { getConfig } from "../config/index.js";
import {
  IgLoginRequiredError,
  IgNoSessionError,
  IgUserHasLoggedOutError,
  InstagramClient,
} from "../instagram/index.js";
import type { SessionState } from "../instagram/index.js";
import type { TwoFactorAuthInfo } from "../types/index.js";
import { consumeRateLimit, formatDuration, RateLimitError } from "../utils/rateLimit.js";
import { deleteSession, loadSession, saveSession } from "./session.js";

/**
 * True when Instagram rejected the session itself (login_required,
 * user_has_logged_out) or there is no session. Other failures (network
 * errors, rate limits, 5xx) say nothing about the session, so it is kept:
 * discarding it forces a fresh login, which tends to trigger Instagram's
 * suspicious-login checkpoints.
 */
export function isInvalidSessionError(error: unknown): boolean {
  return (
    error instanceof IgLoginRequiredError ||
    error instanceof IgUserHasLoggedOutError ||
    error instanceof IgNoSessionError
  );
}

/** Message of the error thrown by a login that a logout overtook. */
export const LOGIN_CANCELLED_MESSAGE = "Login was cancelled by a logout.";

/** Thrown by login() while password login is unavailable. */
export const PASSWORD_LOGIN_UNAVAILABLE_MESSAGE =
  "Password login is not available: Instagram no longer accepts the login request this server used to send. " +
  "Log in to instagram.com in a browser, copy the value of its `sessionid` cookie, set it as IG_SESSION_ID " +
  "in the MCP server configuration, and restart the server.";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

/**
 * The configured IG_USERNAME when it is an Instagram username. Instagram also
 * accepts an email address or phone number as the login name; those cannot be
 * compared with a session's username, so they return undefined.
 */
function configuredUsername(): string | undefined {
  const raw = getConfig().igpapi?.username;
  if (!raw) {
    return undefined;
  }
  const name = normalizeUsername(raw);
  if (!/^[a-z0-9._]{1,30}$/.test(name) || /^\d+$/.test(name)) {
    return undefined;
  }
  return name;
}

/** The numeric user id a sessionid cookie starts with ("<id>%3A..." or "<id>:..."). */
export function userIdFromSessionId(sessionid: string): string | undefined {
  const match = /^(\d+)(?:%3A|:)/i.exec(sessionid);
  return match && sessionid.length >= 30 ? match[1] : undefined;
}

interface CurrentUserResponse {
  user?: { pk?: number | string; pk_id?: string; username?: string; full_name?: string; [key: string]: unknown };
}

export interface IGPAPIClientOptions {
  /** Builds the InstagramClient; tests inject one with a fake fetch. */
  createClient?: (session?: SessionState) => InstagramClient;
}

export class IGPAPIClient {
  private client: InstagramClient | null = null;
  private username: string | null = null;
  private initialized: boolean = false;
  private loggedIn: boolean = false;
  private twoFactorInfo: TwoFactorAuthInfo | null = null;
  private readonly createClient: (session?: SessionState) => InstagramClient;
  /**
   * Incremented by logout() and reset(). A restore or login that was in
   * flight when it changed abandons its result instead of resurrecting a
   * session the user just logged out of.
   */
  private authEpoch = 0;
  /**
   * Why the last login attempt failed, so a later rate-limit rejection can say
   * so instead of hiding it (e.g. the startup login used the budget).
   */
  private lastLoginFailure: { message: string; at: number } | null = null;

  constructor(options: IGPAPIClientOptions = {}) {
    this.createClient = options.createClient ?? ((session) => new InstagramClient({ session }));
  }

  private recordLoginFailure(error: unknown): void {
    this.lastLoginFailure = {
      message: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    };
  }

  /** consumeRateLimit("login"), with the previous failure appended to a rejection. */
  private consumeLoginBudget(): void {
    try {
      consumeRateLimit("login");
    } catch (error) {
      const failure = this.lastLoginFailure;
      if (error instanceof RateLimitError && failure) {
        throw new RateLimitError(
          `${error.message} The previous login attempt (${formatDuration(Date.now() - failure.at)} ago) failed: ${failure.message}`,
          error.action,
          error.retryAfterMs
        );
      }
      throw error;
    }
  }

  /** Throws if a logout happened since `epoch` was captured. */
  private assertCurrent(epoch: number): void {
    if (epoch !== this.authEpoch) {
      throw new Error(LOGIN_CANCELLED_MESSAGE);
    }
  }

  /** Saves the client's session and marks it logged in, unless a logout overtook the login. */
  private async commitLogin(client: InstagramClient, epoch: number, username: string): Promise<void> {
    this.assertCurrent(epoch);
    await saveSession(client.serialize());
    if (epoch !== this.authEpoch) {
      // A logout ran while the file was being written.
      await deleteSession();
      throw new Error(LOGIN_CANCELLED_MESSAGE);
    }
    this.username = username;
    this.loggedIn = true;
    this.twoFactorInfo = null;
    this.lastLoginFailure = null;
  }

  /** Discards a restored session that belongs to another account. */
  private async discardSession(epoch: number, client: InstagramClient, reason: string): Promise<void> {
    console.error(`[mcp-instagram] ${reason}; discarding the saved session.`);
    await deleteSession();
    if (epoch === this.authEpoch) {
      client.clearSession();
      this.loggedIn = false;
      this.username = null;
    }
  }

  /**
   * Creates the client and restores the saved session. If IG_SESSION_ID is
   * set and differs from the saved session, the configured cookie is used.
   */
  async initialize(): Promise<void> {
    if (this.client) {
      return; // Already initialized
    }

    const epoch = this.authEpoch;
    this.initialized = true;
    const saved = await loadSession();
    if (epoch !== this.authEpoch) {
      return;
    }
    const client = this.createClient(saved ?? undefined);
    this.client = client;

    const configuredSessionId = getConfig().igpapi?.sessionId;
    if (configuredSessionId && saved?.authorization?.sessionid !== configuredSessionId) {
      try {
        await this.loginWithSessionId(configuredSessionId);
      } catch (error) {
        if (error instanceof Error && error.message !== LOGIN_CANCELLED_MESSAGE) {
          console.error("[mcp-instagram] Could not use IG_SESSION_ID:", error.message);
        }
      }
      return;
    }

    if (!saved || !client.hasSession) {
      return;
    }

    // A saved session for a different account than IG_USERNAME (switched
    // accounts, or a planted file) must not silently become the active one.
    const expected = configuredUsername();
    if (expected && saved.username && normalizeUsername(saved.username) !== expected) {
      await this.discardSession(epoch, client, `The saved session belongs to @${saved.username}, not IG_USERNAME (@${expected})`);
      return;
    }

    try {
      const user = (await client.request<CurrentUserResponse>({ path: "accounts/current_user/", query: { edit: true } })).user;
      if (epoch !== this.authEpoch) {
        return;
      }
      const username = typeof user?.username === "string" ? user.username : undefined;
      if (expected && username && normalizeUsername(username) !== expected) {
        await this.discardSession(epoch, client, `The saved session belongs to @${username}, not IG_USERNAME (@${expected})`);
        return;
      }
      client.setAccount(String(user?.pk ?? client.userId ?? ""), username);
      this.username = username ?? saved.username ?? null;
      this.loggedIn = true;
    } catch (error) {
      if (epoch !== this.authEpoch) {
        return;
      }
      if (isInvalidSessionError(error)) {
        await deleteSession();
        client.clearSession();
        this.loggedIn = false;
      } else {
        // Could not verify (e.g. offline). Keep the restored session; if it
        // turns out to be invalid, tools report it and login re-authenticates.
        console.error(
          "[mcp-instagram] Could not verify the saved session; keeping it:",
          error instanceof Error ? error.message : String(error)
        );
        this.username = saved.username ?? null;
        this.loggedIn = true;
      }
    }
  }

  /**
   * Logs in with a `sessionid` cookie from a browser session: no password is
   * sent. Verifies it with Instagram and saves the session.
   */
  async loginWithSessionId(sessionid: string): Promise<void> {
    const trimmed = sessionid.trim();
    const userId = userIdFromSessionId(trimmed);
    if (!userId) {
      throw new Error(
        "IG_SESSION_ID does not look like an Instagram sessionid cookie: it should start with your numeric user id, " +
          'followed by "%3A" or ":".'
      );
    }
    if (!this.client) {
      await this.initialize();
      const current = this.client as InstagramClient | null;
      if (this.loggedIn && current?.serialize().authorization?.sessionid === trimmed) {
        return; // initialize() already imported this cookie.
      }
    }
    const client = this.client;
    if (!client) {
      throw new Error("Failed to initialize the Instagram client");
    }
    const epoch = this.authEpoch;
    this.consumeLoginBudget();

    client.clearSession();
    client.setAuthorization({ ds_user_id: userId, sessionid: trimmed, should_use_header_over_cookies: true });
    this.loggedIn = false;
    try {
      const response = await client.request<CurrentUserResponse>({ path: "accounts/current_user/", query: { edit: true } });
      this.assertCurrent(epoch);
      const username = typeof response.user?.username === "string" ? response.user.username : undefined;
      const expected = configuredUsername();
      if (expected && username && normalizeUsername(username) !== expected) {
        throw new Error(`IG_SESSION_ID belongs to @${username}, not IG_USERNAME (@${expected}).`);
      }
      client.setAccount(String(response.user?.pk ?? userId), username);
      await this.commitLogin(client, epoch, username ?? userId);
    } catch (error) {
      if (epoch === this.authEpoch) {
        client.clearSession();
        if (!(error instanceof Error && error.message === LOGIN_CANCELLED_MESSAGE)) {
          this.recordLoginFailure(error);
        }
      }
      throw error;
    }
  }

  /**
   * Login to Instagram with username and password.
   *
   * Instagram now rejects the login flow this server implemented (HTTP 404 /
   * needs_upgrade), so this throws until the newer flow is ported. Use
   * loginWithSessionId (IG_SESSION_ID) instead.
   * @throws {TwoFactorAuthInfo} If 2FA is required, throws an object with 2FA info
   */
  async login(_username: string, _password: string): Promise<void> {
    if (!this.client) {
      await this.initialize();
    }
    const error = new Error(PASSWORD_LOGIN_UNAVAILABLE_MESSAGE);
    this.recordLoginFailure(error);
    throw error;
  }

  /**
   * Complete 2FA login with verification code
   */
  async completeTwoFactorLogin(_verificationCode: string): Promise<void> {
    if (!this.client) {
      throw new Error("Instagram client not initialized. Please call login first.");
    }
    if (!this.twoFactorInfo) {
      throw new Error("No pending 2FA login. Please call login first.");
    }
    throw new Error(PASSWORD_LOGIN_UNAVAILABLE_MESSAGE);
  }

  /**
   * Get pending 2FA information
   */
  getTwoFactorInfo(): TwoFactorAuthInfo | null {
    return this.twoFactorInfo;
  }

  /**
   * Check if 2FA is pending
   */
  hasPendingTwoFactor(): boolean {
    return this.twoFactorInfo !== null;
  }

  /**
   * The Instagram client, holding the restored session if there is one.
   */
  getClient(): InstagramClient {
    if (!this.initialized || !this.client) {
      throw new Error("Instagram client not initialized. Call initialize() first.");
    }
    return this.client;
  }

  /**
   * Check if client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Username of the logged-in account, if known
   */
  getUsername(): string | null {
    return this.username;
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  /**
   * The logged-in account (raw `user` from accounts/current_user).
   */
  async getCurrentUser(): Promise<NonNullable<CurrentUserResponse["user"]>> {
    if (!this.client || !this.loggedIn) {
      throw new Error("Not logged in. Please login first.");
    }
    const response = await this.client.request<CurrentUserResponse>({ path: "accounts/current_user/", query: { edit: true } });
    if (!response.user) {
      throw new Error("Instagram returned no user for the current session.");
    }
    return response.user;
  }

  /**
   * Clears the local session (memory and file). Ending the session on
   * Instagram's side is the logout tool's job.
   */
  async logout(): Promise<void> {
    this.reset();
    await deleteSession();
  }

  /**
   * Reset/clear the client (keeps instance but clears state)
   */
  reset(): void {
    this.authEpoch++;
    const client = this.client;
    this.client = null;
    this.username = null;
    this.initialized = false;
    this.loggedIn = false;
    this.twoFactorInfo = null;
    void client?.close().catch(() => undefined);
  }
}

// Singleton instance
export const igpapiClient = new IGPAPIClient();
