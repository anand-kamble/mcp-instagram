/**
 * Instagram Follow User Tool
 * Allows following Instagram users by user ID
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class FollowUserTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_follow_user",
      description: "Follow an Instagram user by user ID. Requires authentication. May require approval for private accounts.",
      inputSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID to follow",
          },
        },
        required: ["userId"],
      },
    };
  }

  async execute(args: { userId: string }): Promise<ToolResult> {
    const { userId } = args;

    // Validate userId
    if (typeof userId !== "string") {
      throw new Error("userId is required and must be a string");
    }

    const userIdTrimmed = userId.trim();
    if (userIdTrimmed.length === 0) {
      throw new Error("userId cannot be empty");
    }

    // Check if logged in
    if (!igpapiClient.isLoggedIn()) {
      throw new Error("Not logged in. Please use the instagram_login tool to authenticate first.");
    }

    // Ensure client is initialized
    if (!igpapiClient.isInitialized()) {
      await igpapiClient.initialize();
    }

    const client = igpapiClient.getClient();

    try {
      // Call the API to follow the user
      const friendshipStatus = await client.friendship.create(userIdTrimmed);

      // Format success response
      let response = `Successfully followed user with ID: ${userIdTrimmed}`;
      
      // Include friendship status information if available
      if (friendshipStatus) {
        const status = friendshipStatus as any;
        if (status.following !== undefined) {
          response += `. Following: ${status.following}`;
        }
        if (status.outgoing_request !== undefined && status.outgoing_request) {
          response += ` (follow request sent - approval required for private account)`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: response,
          },
        ],
      };
    } catch (error: any) {
      // Handle specific error cases
      if (error?.message) {
        const errorMessage = error.message.toLowerCase();

        // Authentication errors
        if (
          errorMessage.includes("not logged in") ||
          errorMessage.includes("login") ||
          errorMessage.includes("authentication") ||
          errorMessage.includes("unauthorized") ||
          error?.response?.status === 401
        ) {
          throw new Error("Authentication required. Please use the instagram_login tool to authenticate first.");
        }

        // Session expired
        if (
          errorMessage.includes("session") ||
          errorMessage.includes("expired") ||
          errorMessage.includes("invalid")
        ) {
          throw new Error("Session has expired. Please use the instagram_login tool to re-authenticate.");
        }

        // User not found
        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("invalid user") ||
          errorMessage.includes("user not found") ||
          error?.response?.status === 404
        ) {
          throw new Error(`User not found with ID "${userIdTrimmed}". Please verify the user ID is correct.`);
        }

        // Rate limiting
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("too many requests") ||
          error?.response?.status === 429
        ) {
          throw new Error("Rate limit exceeded. Please wait before trying again.");
        }

        // Already following (Instagram API may return success, but handle if it throws)
        if (
          errorMessage.includes("already following") ||
          errorMessage.includes("duplicate") ||
          errorMessage.includes("already follow")
        ) {
          return {
            content: [
              {
                type: "text",
                text: `User with ID "${userIdTrimmed}" is already being followed.`,
              },
            ],
          };
        }

        // Cannot follow (blocked, etc.)
        if (
          errorMessage.includes("cannot follow") ||
          errorMessage.includes("blocked") ||
          errorMessage.includes("not allowed to follow")
        ) {
          throw new Error(`Cannot follow user with ID "${userIdTrimmed}". The user may have blocked you or have restrictions.`);
        }
      }

      // Re-throw other errors to be handled by base error handling
      throw error;
    }
  }
}

