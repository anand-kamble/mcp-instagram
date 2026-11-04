/**
 * Common types and interfaces for Instagram MCP tools
 */

export interface IGPAPIConfig {
  username?: string;
  password?: string;
  sessionId?: string;
  deviceId?: string;
}

export interface TwoFactorAuthInfo {
  username: string;
  twoFactorIdentifier: string;
  verificationMethod: "0" | "1"; // '0' = TOTP, '1' = SMS
  totpTwoFactorOn: boolean;
}

