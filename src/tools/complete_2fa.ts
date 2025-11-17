/**
 * Instagram Complete 2FA Login Tool
 * Completes the login process after 2FA verification code is provided
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class Complete2FATool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_complete_2fa",
      description: "Complete Instagram login by providing the 2FA verification code. Use this after 'instagram_login' indicates 2FA is required.",
      inputSchema: {
        type: "object",
        properties: {
          verification_code: {
            type: "string",
            description: "The 2FA verification code received via SMS or from your authenticator app",
          },
        },
        required: ["verification_code"],
      },
    };
  }

  async execute(args: { verification_code: string }): Promise<ToolResult> {
    const { verification_code } = args;

    // Validate input
    if (!verification_code || verification_code.trim().length === 0) {
      throw new Error("Verification code is required");
    }

    // Check if there's a pending 2FA login
    if (!igpapiClient.hasPendingTwoFactor()) {
      throw new Error(
        "No pending 2FA login found. Please call 'instagram_login' first to initiate the login process."
      );
    }

    const twoFactorInfo = igpapiClient.getTwoFactorInfo();
    if (!twoFactorInfo) {
      throw new Error("2FA information not available. Please try logging in again.");
    }

    try {
      // Complete 2FA login
      await igpapiClient.completeTwoFactorLogin(verification_code.trim());

      // Get user info to confirm login
      const user = await igpapiClient.getCurrentUser();

      const methodName = twoFactorInfo.verificationMethod === "1" ? "SMS" : "TOTP";

      return {
        content: [
          {
            type: "text",
            text: `Successfully completed 2FA login to Instagram!\n\nAccount: ${user.username}\nFull Name: ${user.full_name || "N/A"}\nUser ID: ${user.pk}\n2FA Method: ${methodName}\n\nSession has been saved and will persist across server restarts.`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check for common 2FA errors
      if (errorMessage.includes("code") || errorMessage.includes("verification")) {
        throw new Error(
          `Invalid verification code. Please check the code and try again. If the code expired, please call 'instagram_login' again to receive a new code.`
        );
      }

      throw error;
    }
  }
}

