/**
 * Instagram Logout Tool
 * Logs out from Instagram and clears the saved session
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class LogoutTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_logout",
      description: "Logout from Instagram and clear the saved session. This will invalidate the current session and require re-authentication for future operations.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // Check if already logged out
    if (!igpapiClient.isLoggedIn()) {
      return {
        content: [
          {
            type: "text",
            text: "Already logged out. No active session to clear.",
          },
        ],
      };
    }

    // Get current user info before logout (for confirmation message)
    let username: string | undefined;
    try {
      const currentUser = await igpapiClient.getCurrentUser();
      username = currentUser.username;
    } catch {
      // User info might not be available, continue with logout anyway
    }

    // Perform logout
    await igpapiClient.logout();

    return {
      content: [
        {
          type: "text",
          text: `Successfully logged out from Instagram${username ? ` (${username})` : ""}.\n\nSession has been cleared. You will need to login again to use Instagram features.`,
        },
      ],
    };
  }
}

