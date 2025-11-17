/**
 * Instagram Login Tool
 * Allows LLM to login to an Instagram account with persistent session
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";
import { getConfig } from "../config/index.js";

export class LoginTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_login",
      description: "Login to an Instagram account using credentials from environment variables (IG_USERNAME and IG_PASSWORD). The session will be saved and persist across server restarts.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // Get credentials from environment variables via config
    const config = getConfig();
    const username = config.igpapi?.username;
    const password = config.igpapi?.password;

    // Validate that credentials are available
    if (!username || !password) {
      throw new Error(
        "Instagram credentials not found in environment variables. " +
        "Please set IG_USERNAME and IG_PASSWORD environment variables."
      );
    }

    // Check if already logged in
    if (igpapiClient.isLoggedIn()) {
      try {
        const currentUser = await igpapiClient.getCurrentUser();
        return {
          content: [
            {
              type: "text",
              text: `Already logged in as: ${currentUser.username || username}\nSession is active and persistent.`,
            },
          ],
        };
      } catch {
        // Session might be invalid, continue with login
      }
    }

    // Initialize client if needed
    if (!igpapiClient.isInitialized()) {
      await igpapiClient.initialize();
    }

    try {
      // Perform login
      await igpapiClient.login(username, password);

      // Get user info to confirm login
      const user = await igpapiClient.getCurrentUser();

      return {
        content: [
          {
            type: "text",
            text: `Successfully logged in to Instagram!\n\nAccount: ${user.username}\nFull Name: ${user.full_name || "N/A"}\nUser ID: ${user.pk}\n\nSession has been saved and will persist across server restarts.`,
          },
        ],
      };
    } catch (error) {
      // Check if this is a 2FA requirement
      if (error && typeof error === "object" && "verificationMethod" in error) {
        const twoFactorInfo = error as {
          username: string;
          verificationMethod: "0" | "1";
          totpTwoFactorOn: boolean;
        };

        const methodName = twoFactorInfo.verificationMethod === "1" ? "SMS" : "TOTP (Authenticator App)";
        const codeSentMessage = twoFactorInfo.verificationMethod === "1" 
          ? "A verification code has been sent to your phone via SMS."
          : "Please check your authenticator app for the verification code.";

        return {
          content: [
            {
              type: "text",
              text: `Two-Factor Authentication (2FA) is required for this account.\n\n${codeSentMessage}\n\nVerification Method: ${methodName}\nUsername: ${twoFactorInfo.username}\n\nPlease use the 'instagram_complete_2fa' tool with the verification code to complete the login.`,
            },
          ],
          isError: false, // Not an error, just requires additional step
        };
      }

      // Re-throw other errors
      throw error;
    }
  }
}

