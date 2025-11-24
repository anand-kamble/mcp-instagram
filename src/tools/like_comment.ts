/**
 * Instagram Like Comment Tool
 * Allows liking Instagram comments by comment ID
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class LikeCommentTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_like_comment",
      description: "Like an Instagram comment by comment ID. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          commentId: {
            type: "string",
            description: "Comment ID to like",
          },
        },
        required: ["commentId"],
      },
    };
  }

  async execute(args: { commentId: string }): Promise<ToolResult> {
    const { commentId } = args;

    // Validate commentId
    if (typeof commentId !== "string") {
      throw new Error("commentId is required and must be a string");
    }

    const commentIdTrimmed = commentId.trim();
    if (commentIdTrimmed.length === 0) {
      throw new Error("commentId cannot be empty");
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
      // Call the API to like the comment
      await client.media.likeComment(commentIdTrimmed);

      // Format success response
      const response = `Successfully liked comment with ID: ${commentIdTrimmed}`;

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

        // Comment not found
        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("invalid comment") ||
          errorMessage.includes("comment not found") ||
          error?.response?.status === 404
        ) {
          throw new Error(`Comment not found with ID "${commentIdTrimmed}". Please verify the comment ID is correct.`);
        }

        // Rate limiting
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("too many requests") ||
          error?.response?.status === 429
        ) {
          throw new Error("Rate limit exceeded. Please wait before trying again.");
        }

        // Already liked (Instagram API may return success, but handle if it throws)
        if (errorMessage.includes("already liked") || errorMessage.includes("duplicate")) {
          return {
            content: [
              {
                type: "text",
                text: `Comment with ID "${commentIdTrimmed}" is already liked.`,
              },
            ],
          };
        }
      }

      // Re-throw other errors to be handled by base error handling
      throw error;
    }
  }
}

