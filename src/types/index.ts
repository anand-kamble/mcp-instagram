/**
 * Common types and interfaces for Instagram MCP tools
 */

export interface TwoFactorAuthInfo {
  username: string;
  twoFactorIdentifier: string;
  verificationMethod: "0" | "1"; // '0' = TOTP, '1' = SMS
  totpTwoFactorOn: boolean;
  /** Where Instagram most likely sent the code (CAA login). */
  delivery?: "email" | "sms" | "authenticator" | "unknown";
}

