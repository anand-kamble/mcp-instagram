/**
 * Common types and interfaces for Instagram MCP tools
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

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

