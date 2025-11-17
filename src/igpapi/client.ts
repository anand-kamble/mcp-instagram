/**
 * IGPAPI Client Manager
 * Handles initialization and state management for Instagram Private API
 */

import { IgApiClient, IgLoginTwoFactorRequiredError } from "instagram-private-api";
import type { IGPAPIConfig, TwoFactorAuthInfo } from "../types/index.js";
import { loadSession, saveSession, deleteSession } from "./session.js";

export class IGPAPIClient {
  private client: IgApiClient | null = null;
  private config: IGPAPIConfig | null = null;
  private initialized: boolean = false;
  private loggedIn: boolean = false;
  private twoFactorInfo: TwoFactorAuthInfo | null = null;

  /**
   * Initialize the IGPAPI client instance
   */
  async initialize(): Promise<void> {
    if (this.client) {
      return; // Already initialized
    }

    this.client = new IgApiClient();
    this.initialized = true;

    // Try to restore session
    const sessionLoaded = await loadSession(this.client);
    if (sessionLoaded) {
      try {
        // Verify session is still valid
        await this.client.account.currentUser();
        this.loggedIn = true;
      } catch {
        // Session invalid, clear it
        await deleteSession();
        this.loggedIn = false;
      }
    }
  }

  /**
   * Login to Instagram with username and password
   * @throws {TwoFactorAuthInfo} If 2FA is required, throws an object with 2FA info
   */
  async login(username: string, password: string): Promise<void> {
    if (!this.client) {
      await this.initialize();
    }

    if (!this.client) {
      throw new Error("Failed to initialize IGPAPI client");
    }

    // Generate device based on username
    this.client.state.generateDevice(username);

    try {
      // Perform login
      await this.client.account.login(username, password);

      // Save session
      await saveSession(this.client);

      this.config = { username, password };
      this.loggedIn = true;
      this.twoFactorInfo = null; // Clear any pending 2FA info
    } catch (error: unknown) {
      // Check if 2FA is required
      if (error instanceof IgLoginTwoFactorRequiredError) {
        const twoFactorError = error as IgLoginTwoFactorRequiredError;
        const twoFactorInfo = twoFactorError.response?.body?.two_factor_info;
        
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
  }

  /**
   * Complete 2FA login with verification code
   */
  async completeTwoFactorLogin(verificationCode: string): Promise<void> {
    if (!this.client) {
      throw new Error("IGPAPI client not initialized. Please call login first.");
    }

    if (!this.twoFactorInfo) {
      throw new Error("No pending 2FA login. Please call login first.");
    }

    try {
      // Complete 2FA login
      await this.client.account.twoFactorLogin({
        username: this.twoFactorInfo.username,
        verificationCode,
        twoFactorIdentifier: this.twoFactorInfo.twoFactorIdentifier,
        verificationMethod: this.twoFactorInfo.verificationMethod,
        trustThisDevice: "1", // Trust this device
      });

      // Save session
      await saveSession(this.client);

      this.loggedIn = true;
      this.config = { username: this.twoFactorInfo.username };
      this.twoFactorInfo = null; // Clear 2FA info after successful login
    } catch (error) {
      // Clear 2FA info on error so user can retry
      this.twoFactorInfo = null;
      throw error;
    }
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
    await deleteSession();
    this.client = null;
    this.config = null;
    this.initialized = false;
    this.loggedIn = false;
    this.twoFactorInfo = null;
  }

  /**
   * Reset/clear the client (keeps instance but clears state)
   */
  reset(): void {
    this.client = null;
    this.config = null;
    this.initialized = false;
    this.loggedIn = false;
    this.twoFactorInfo = null;
  }
}

// Singleton instance
export const igpapiClient = new IGPAPIClient();

