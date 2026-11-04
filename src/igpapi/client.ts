/**
 * Session manager for the Instagram client.
 *
 * Owns the single InstagramClient the tools use: restores the saved session,
 * logs in, and logs out. Instagram traffic goes through src/instagram (our own
 * private-API client); this module keeps the public methods the tools and the
 * startup code call.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../config/index.js";
import {
  CaaLogin,
  IgLoginCancelledError,
  IgLoginFlowError,
  IgLoginRequiredError,
  IgNoSessionError,
  IgUserHasLoggedOutError,
  InstagramClient,
} from "../instagram/index.js";
import type { PendingTwoFactor, SessionState } from "../instagram/index.js";
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

/**
 * Explanation for when Instagram refuses password login from this server.
 * Kept for callers that surface it; login() itself now runs the CAA flow.
 */
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

/**
 * With IG_DEBUG_CAPTURE=<dir>, a login that hits a screen the flow does not
 * handle writes Instagram's recent login-flow responses (tokens and session
 * ids redacted) to <dir>/caa-<time>.json with mode 0600, for porting the
 * screen. Off by default; the files may still contain account details.
 */
export function writeDebugCapture(caa: CaaLogin, error: Error): string | undefined {
  const dir = process.env.IG_DEBUG_CAPTURE;
  if (!dir) return undefined;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `caa-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ error: `${error.name}: ${error.message}`, responses: caa.trace }, null, 1), {
      mode: 0o600,
      flag: "wx",
    });
    console.error(`[mcp-instagram] Saved the login-flow responses to ${file} (IG_DEBUG_CAPTURE).`);
    return file;
  } catch (writeError) {
    console.error("[mcp-instagram] Could not write IG_DEBUG_CAPTURE file:", writeError instanceof Error ? writeError.message : String(writeError));
    return undefined;
  }
}

/** SHA-256 of an IG_SESSION_ID value, so the session file records its source without storing it again. */
export function sessionIdFingerprint(sessionid: string): string {
  return createHash("sha256").update(sessionid.trim()).digest("hex");
}

interface CurrentUserResponse {
  user?: { pk?: number | string; pk_id?: string; username?: string; full_name?: string; [key: string]: unknown };
}

export interface IGPAPIClientOptions {
  /** Builds the InstagramClient; tests inject one with a fake fetch. */
  createClient?: (session?: SessionState) => InstagramClient;
  /** Delay before paced login steps, as the app waits (default 1000 ms; tests use 0). */
  loginPaceMs?: number;
}

export class IGPAPIClient {
  private client: InstagramClient | null = null;
  private username: string | null = null;
  private initialized: boolean = false;
  private loggedIn: boolean = false;
  private twoFactorInfo: TwoFactorAuthInfo | null = null;
  private readonly createClient: (session?: SessionState) => InstagramClient;
  private readonly loginPaceMs: number;
  /** A password login waiting for its verification code. */
  private pendingLogin: { caa: CaaLogin; pending: PendingTwoFactor; username: string } | null = null;
  /**
   * Set by an explicit logout: IG_SESSION_ID is then not imported again
   * automatically until the next login call or a restart.
   */
  private loggedOutByUser = false;
  /** Serialises logins, so two flows never interleave on the shared client. */
  private authQueue: Promise<unknown> = Promise.resolve();
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
    this.loginPaceMs = options.loginPaceMs ?? 1000;
  }

  /** Runs `fn` after any login operation already in progress has finished. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.authQueue.then(fn);
    this.authQueue = run.catch(() => undefined);
    return run;
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
  private async commitLogin(
    client: InstagramClient,
    epoch: number,
    username: string,
    extra: Partial<SessionState> = {}
  ): Promise<void> {
    this.assertCurrent(epoch);
    await saveSession({ ...client.serialize(), ...extra });
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

    const configuredSessionId = getConfig().igpapi?.sessionId?.trim();
    // Instagram may rotate the session after import, so compare with what it was imported from.
    const importedFromConfig =
      configuredSessionId !== undefined &&
      (saved?.importedSessionIdSha256 === sessionIdFingerprint(configuredSessionId) ||
        saved?.authorization?.sessionid === configuredSessionId);
    if (configuredSessionId && !importedFromConfig) {
      if (this.loggedOutByUser) {
        return; // Stay logged out until the user logs in again.
      }
      try {
        await this.exclusive(() => {
          this.assertCurrent(epoch);
          return this.loginWithSessionIdNow(configuredSessionId);
        });
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

    // The restored session must belong to the account IG_SESSION_ID names.
    const configuredUserId = configuredSessionId ? userIdFromSessionId(configuredSessionId) : undefined;
    if (configuredUserId && client.userId && client.userId !== configuredUserId) {
      await this.discardSession(epoch, client, "The saved session does not belong to the account in IG_SESSION_ID");
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
    if (!userIdFromSessionId(sessionid.trim())) {
      throw new Error(
        "IG_SESSION_ID does not look like an Instagram sessionid cookie: it should start with your numeric user id, " +
          'followed by "%3A" or ":".'
      );
    }
    this.loggedOutByUser = false;
    if (!this.client) {
      await this.initialize();
    }
    // A logout after this call was made cancels it, even if it is still queued.
    const epoch = this.authEpoch;
    return this.exclusive(async () => {
      this.assertCurrent(epoch);
      const current = this.client as InstagramClient | null;
      if (this.loggedIn && current?.serialize().authorization?.sessionid === sessionid.trim()) {
        return; // initialize() already imported this cookie.
      }
      await this.loginWithSessionIdNow(sessionid);
    });
  }

  /** loginWithSessionId's work; callers hold the auth queue. */
  private async loginWithSessionIdNow(sessionid: string): Promise<void> {
    const trimmed = sessionid.trim();
    const userId = userIdFromSessionId(trimmed);
    if (!userId) {
      throw new Error("IG_SESSION_ID does not look like an Instagram sessionid cookie.");
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
      await this.commitLogin(client, epoch, username ?? userId, { importedSessionIdSha256: sessionIdFingerprint(trimmed) });
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
   * Login to Instagram with username and password, through Instagram's
   * current CAA login flow. The password is submitted once and not kept.
   * @throws {TwoFactorAuthInfo} If a verification code is needed; finish with completeTwoFactorLogin()
   */
  async login(username: string, password: string): Promise<void> {
    this.loggedOutByUser = false;
    if (!this.client) {
      await this.initialize();
    }
    const epoch = this.authEpoch;
    return this.exclusive(() => {
      this.assertCurrent(epoch);
      return this.loginNow(username, password);
    });
  }

  /** login's work; callers hold the auth queue. */
  private async loginNow(username: string, password: string): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error("Failed to initialize the Instagram client");
    }
    const epoch = this.authEpoch;
    // Every call is a fresh password login (and possibly a code sent to the
    // user). Instagram checkpoints accounts that do this repeatedly.
    this.consumeLoginBudget();
    this.pendingLogin = null;
    this.twoFactorInfo = null;
    this.loggedIn = false;
    client.clearSession();

    const caa = new CaaLogin(client, this.loginPaceMs, () => epoch === this.authEpoch);
    let start;
    try {
      start = await caa.start(username, password);
    } catch (error) {
      if (epoch === this.authEpoch) {
        this.recordLoginFailure(error);
      }
      if (error instanceof IgLoginFlowError && !(error instanceof IgLoginCancelledError)) {
        writeDebugCapture(caa, error);
      }
      throw error;
    }
    this.assertCurrent(epoch);

    if (start.status === "two_factor") {
      const { pending } = start;
      this.pendingLogin = { caa, pending, username };
      this.twoFactorInfo = {
        username,
        twoFactorIdentifier: pending.route,
        verificationMethod: pending.method === "sms" ? "1" : "0",
        totpTwoFactorOn: pending.method === "totp",
        delivery: pending.delivery,
      };
      throw this.twoFactorInfo;
    }
    await this.finishPasswordLogin(client, epoch, username);
  }

  /**
   * Complete 2FA login with verification code
   */
  async completeTwoFactorLogin(verificationCode: string): Promise<void> {
    const epoch = this.authEpoch;
    return this.exclusive(() => {
      this.assertCurrent(epoch);
      return this.completeTwoFactorLoginNow(verificationCode);
    });
  }

  private async completeTwoFactorLoginNow(verificationCode: string): Promise<void> {
    if (!this.client) {
      throw new Error("Instagram client not initialized. Please call login first.");
    }
    const pendingLogin = this.pendingLogin;
    if (!this.twoFactorInfo || !pendingLogin) {
      throw new Error("No pending 2FA login. Please call login first.");
    }
    const client = this.client;
    const epoch = this.authEpoch;
    try {
      await pendingLogin.caa.submitCode(pendingLogin.pending, verificationCode);
    } catch (error) {
      if (epoch === this.authEpoch) {
        // Clear the pending login so the user can start over.
        this.pendingLogin = null;
        this.twoFactorInfo = null;
        this.recordLoginFailure(error);
      }
      throw error;
    }
    this.assertCurrent(epoch);
    this.pendingLogin = null;
    try {
      await this.finishPasswordLogin(client, epoch, pendingLogin.username);
    } catch (error) {
      if (epoch === this.authEpoch) {
        // Leave no half-finished login behind (e.g. the session could not be
        // saved): instagram_login must start over instead of waiting for a
        // code that instagram_complete_2fa can no longer accept.
        this.twoFactorInfo = null;
        this.loggedIn = false;
        client.clearSession();
        if (!(error instanceof Error && error.message === LOGIN_CANCELLED_MESSAGE)) {
          this.recordLoginFailure(error);
        }
      }
      throw error;
    }
  }

  /** Confirms the new session with Instagram, checks the account and saves it. */
  private async finishPasswordLogin(client: InstagramClient, epoch: number, loginName: string): Promise<void> {
    let username = client.username;
    try {
      const response = await client.request<CurrentUserResponse>({ path: "accounts/current_user/", query: { edit: true } });
      this.assertCurrent(epoch);
      if (typeof response.user?.username === "string") username = response.user.username;
      client.setAccount(String(response.user?.pk ?? client.userId ?? ""), username);
    } catch (error) {
      if (error instanceof Error && error.message === LOGIN_CANCELLED_MESSAGE) throw error;
      if (isInvalidSessionError(error)) {
        client.clearSession();
        this.recordLoginFailure(error);
        throw error;
      }
      // The login itself returned a session; a failed confirmation (e.g. a
      // network error) does not invalidate it.
      console.error(
        "[mcp-instagram] Logged in, but could not confirm the account:",
        error instanceof Error ? error.message : String(error)
      );
    }
    const expected = configuredUsername();
    if (expected && username && normalizeUsername(username) !== expected) {
      client.clearSession();
      throw new Error(`Logged in as @${username}, not IG_USERNAME (@${expected}).`);
    }
    await this.commitLogin(client, epoch, username ?? loginName);
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
    this.loggedOutByUser = true;
    await deleteSession();
  }

  /**
   * Reset/clear the client (keeps instance but clears state)
   */
  reset(): void {
    this.authEpoch++;
    // Operations queued before the reset are cancelled (epoch); new ones must not wait for them.
    this.authQueue = Promise.resolve();
    const client = this.client;
    this.client = null;
    this.username = null;
    this.initialized = false;
    this.loggedIn = false;
    this.twoFactorInfo = null;
    this.pendingLogin = null;
    void client?.close().catch(() => undefined);
  }
}

// Singleton instance
export const igpapiClient = new IGPAPIClient();
