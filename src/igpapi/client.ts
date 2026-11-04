/**
 * IGPAPI Client Manager
 * Handles initialization and state management for Instagram Private API
 */

import {
  IgApiClient,
  IgCookieNotFoundError,
  IgLoginRequiredError,
  IgLoginTwoFactorRequiredError,
  IgUserHasLoggedOutError,
} from "instagram-private-api";
import { getConfig } from "../config/index.js";
import type { TwoFactorAuthInfo } from "../types/index.js";
import { consumeRateLimit } from "../utils/rateLimit.js";
import { loadSession, saveSession, deleteSession } from "./session.js";

/**
 * True when Instagram rejected the restored session itself (login_required,
 * user_has_logged_out, or a missing session cookie). Other failures
 * (network errors, rate limits, 5xx) say nothing about the session, so it is
 * kept: discarding it forces a fresh password login, which is what tends to
 * trigger Instagram's suspicious-login checkpoints.
 */
export function isInvalidSessionError(error: unknown): boolean {
  return (
    error instanceof IgLoginRequiredError ||
    error instanceof IgUserHasLoggedOutError ||
    error instanceof IgCookieNotFoundError
  );
}

/**
 * Timeout for every Instagram HTTP request. instagram-private-api sets none,
 * and the underlying `request` library waits indefinitely on a stalled
 * connection, which would hang tool calls (and startup) with it.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Creates an IgApiClient that verifies TLS certificates and times out.
 *
 * instagram-private-api passes `strictSSL: false` on every request, and its
 * built-in options take precedence over `request.defaults`, so certificate
 * checks can only be turned back on per request. Without them, anyone on the
 * network path could read the session cookies, or swap the password
 * encryption key Instagram sends and recover the password.
 */
export function createIgClient(): IgApiClient {
  const client = new IgApiClient();
  client.request.defaults.timeout = REQUEST_TIMEOUT_MS;
  const send = client.request.send.bind(client.request);
  client.request.send = ((options, onlyCheckHttpStatus) =>
    send({ ...options, strictSSL: true }, onlyCheckHttpStatus)) as typeof client.request.send;
  return client;
}

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

/** Username recorded in the session's `ds_user` cookie, if present. */
function sessionCookieUsername(client: IgApiClient): string | undefined {
  try {
    return normalizeUsername(client.state.cookieUsername);
  } catch {
    return undefined;
  }
}

/** Message of the error thrown by a login that a logout overtook. */
export const LOGIN_CANCELLED_MESSAGE = "Login was cancelled by a logout.";

export class IGPAPIClient {
  private client: IgApiClient | null = null;
  private username: string | null = null;
  private initialized: boolean = false;
  private loggedIn: boolean = false;
  private twoFactorInfo: TwoFactorAuthInfo | null = null;
  /**
   * Incremented by logout() and reset(). A restore or login that was in
   * flight when it changed abandons its result instead of resurrecting a
   * session the user just logged out of.
   */
  private authEpoch = 0;

  /**
   * Initialize the IGPAPI client instance
   */
  async initialize(): Promise<void> {
    if (this.client) {
      return; // Already initialized
    }

    const epoch = this.authEpoch;
    const client = createIgClient();
    this.client = client;
    this.initialized = true;

    // Try to restore session
    const sessionLoaded = await loadSession(client);
    if (!sessionLoaded || epoch !== this.authEpoch) {
      return;
    }

    // A saved session for a different account than IG_USERNAME (switched
    // accounts, or a planted file) must not silently become the active one.
    const expected = configuredUsername();
    const cookieUser = sessionCookieUsername(client);
    if (expected && cookieUser && cookieUser !== expected) {
      await this.discardRestoredSession(epoch, cookieUser, expected);
      return;
    }

    try {
      // Verify session is still valid
      const user = await client.account.currentUser();
      if (epoch !== this.authEpoch) {
        return;
      }
      if (expected && user.username && normalizeUsername(user.username) !== expected) {
        await this.discardRestoredSession(epoch, normalizeUsername(user.username), expected);
        return;
      }
      this.username = user.username ?? null;
      this.loggedIn = true;
    } catch (error) {
      if (epoch !== this.authEpoch) {
        return;
      }
      if (isInvalidSessionError(error)) {
        await deleteSession();
        this.loggedIn = false;
      } else {
        // Could not verify (e.g. offline). Keep the restored cookies; if they
        // turn out to be invalid, the login tool re-authenticates.
        console.error(
          "[mcp-instagram] Could not verify the saved session; keeping it:",
          error instanceof Error ? error.message : String(error)
        );
        this.loggedIn = true;
      }
    }
  }

  /** Deletes a restored session that belongs to another account and starts from a clean client. */
  private async discardRestoredSession(epoch: number, found: string, expected: string): Promise<void> {
    console.error(
      `[mcp-instagram] The saved session belongs to @${found}, not IG_USERNAME (@${expected}); discarding it.`
    );
    await deleteSession();
    if (epoch === this.authEpoch) {
      this.client = createIgClient();
      this.loggedIn = false;
      this.username = null;
    }
  }

  /**
   * Save `client`'s session and mark it logged in, unless a logout happened
   * since `epoch` was captured; then undo the save and throw.
   */
  private async commitLogin(client: IgApiClient, epoch: number, username: string): Promise<void> {
    if (epoch !== this.authEpoch) {
      throw new Error(LOGIN_CANCELLED_MESSAGE);
    }
    await saveSession(client);
    if (epoch !== this.authEpoch) {
      // A logout ran while the file was being written.
      await deleteSession();
      throw new Error(LOGIN_CANCELLED_MESSAGE);
    }
    // Keep only the username; the password is not retained after login.
    this.username = username;
    this.loggedIn = true;
    this.twoFactorInfo = null; // Clear any pending 2FA info
  }

  /**
   * Login to Instagram with username and password
   * @throws {TwoFactorAuthInfo} If 2FA is required, throws an object with 2FA info
   */
  async login(username: string, password: string): Promise<void> {
    if (!this.client) {
      await this.initialize();
    }

    const client = this.client;
    if (!client) {
      throw new Error("Failed to initialize IGPAPI client");
    }
    const epoch = this.authEpoch;

    // Every call is a fresh password login (and possibly an SMS). Instagram
    // checkpoints accounts that do this repeatedly, so cap it like writes.
    consumeRateLimit("login");

    // Generate device based on username
    client.state.generateDevice(username);

    let loggedInAs: string | undefined;
    try {
      // Perform login
      const user = await client.account.login(username, password);
      loggedInAs = user?.username;
    } catch (error: unknown) {
      if (epoch !== this.authEpoch) {
        throw new Error(LOGIN_CANCELLED_MESSAGE);
      }
      // Check if 2FA is required
      if (error instanceof IgLoginTwoFactorRequiredError) {
        const twoFactorInfo = error.response?.body?.two_factor_info;

        if (twoFactorInfo) {
          const verificationMethod = twoFactorInfo.totp_two_factor_on ? "0" : "1"; // '0' = TOTP, '1' = SMS

          this.twoFactorInfo = {
            username: twoFactorInfo.username || username,
            twoFactorIdentifier: twoFactorInfo.two_factor_identifier,
            verificationMethod,
            totpTwoFactorOn: twoFactorInfo.totp_two_factor_on || false,
          };

          // Throw the 2FA info so the caller can handle it
          throw this.twoFactorInfo;
        }
      }

      // Re-throw other errors
      throw error;
    }

    await this.commitLogin(client, epoch, loggedInAs || username);
  }

  /**
   * Complete 2FA login with verification code
   */
  async completeTwoFactorLogin(verificationCode: string): Promise<void> {
    const client = this.client;
    if (!client) {
      throw new Error("IGPAPI client not initialized. Please call login first.");
    }

    const pending = this.twoFactorInfo;
    if (!pending) {
      throw new Error("No pending 2FA login. Please call login first.");
    }
    const epoch = this.authEpoch;

    try {
      // Complete 2FA login
      await client.account.twoFactorLogin({
        username: pending.username,
        verificationCode,
        twoFactorIdentifier: pending.twoFactorIdentifier,
        verificationMethod: pending.verificationMethod,
        trustThisDevice: "1", // Trust this device
      });
    } catch (error) {
      if (epoch !== this.authEpoch) {
        throw new Error(LOGIN_CANCELLED_MESSAGE);
      }
      // Clear 2FA info on error so user can retry
      this.twoFactorInfo = null;
      throw error;
    }

    await this.commitLogin(client, epoch, pending.username);
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
   * Get the IGPAPI client instance
   */
  getClient(): IgApiClient {
    if (!this.initialized || !this.client) {
      throw new Error("IGPAPI client not initialized. Call initialize() first.");
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
   * Get current logged in user info
   */
  async getCurrentUser() {
    if (!this.client || !this.loggedIn) {
      throw new Error("Not logged in. Please login first.");
    }
    return await this.client.account.currentUser();
  }

  /**
   * Logout and clear session
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
    this.client = null;
    this.username = null;
    this.initialized = false;
    this.loggedIn = false;
    this.twoFactorInfo = null;
  }
}

// Singleton instance
export const igpapiClient = new IGPAPIClient();

