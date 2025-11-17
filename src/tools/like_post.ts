/**
 * Instagram Like Post Tool
 * Allows liking Instagram posts or reels by media ID
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class LikePostTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_like_post",
      description: "Like an Instagram post or reel by media ID. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          mediaId: {
            type: "string",
            description: "Post/media ID to like",
          },
          module: {
            type: "string",
            description: "Module info for tracking (e.g., 'feed_timeline', 'profile', 'explore')",
          },
        },
        required: ["mediaId"],
      },
    };
  }

  async execute(args: { mediaId: string; module?: string }): Promise<ToolResult> {
    const { mediaId, module } = args;

    // Validate mediaId
    if (!mediaId || typeof mediaId !== "string") {
      throw new Error("mediaId is required and must be a string");
    }

    const mediaIdTrimmed = mediaId.trim();
    if (mediaIdTrimmed.length === 0) {
      throw new Error("mediaId cannot be empty");
    }

    // Validate module if provided
    if (module !== undefined && (typeof module !== "string" || module.trim().length === 0)) {
      throw new Error("module must be a non-empty string if provided");
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
      // Call the API to like the post
      // moduleInfo is required - use feed_timeline as default, or use provided module if it matches a valid module_name
      const moduleInfo = module?.trim() 
        ? { module_name: module.trim() as any }
        : { module_name: 'feed_timeline' as const };
      
      await client.media.like({
        mediaId: mediaIdTrimmed,
        moduleInfo,
        d: 1,
      });

      // Format success response
      let response = `Successfully liked post with media ID: ${mediaIdTrimmed}`;
      if (module) {
        response += ` (module: ${module.trim()})`;
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

        // Media not found
        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("invalid media") ||
          errorMessage.includes("media not found") ||
          error?.response?.status === 404
        ) {
          throw new Error(`Media not found with ID "${mediaIdTrimmed}". Please verify the media ID is correct.`);
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
                text: `Post with media ID "${mediaIdTrimmed}" is already liked.`,
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

