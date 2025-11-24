/**
 * Instagram Comment on Post Tool
 * Allows adding comments to Instagram posts or replying to existing comments
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class CommentOnPostTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_comment_on_post",
      description: "Add a comment to an Instagram post or reply to an existing comment. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          mediaId: {
            type: "string",
            description: "Post/media ID to comment on",
          },
          text: {
            type: "string",
            description: "Comment text (max 2200 characters)",
          },
          replyToCommentId: {
            type: "string",
            description: "ID of comment to reply to (optional, for replying to existing comments)",
          },
        },
        required: ["mediaId", "text"],
      },
    };
  }

  async execute(args: { mediaId: string; text: string; replyToCommentId?: string }): Promise<ToolResult> {
    const { mediaId, text, replyToCommentId } = args;

    // Validate mediaId
    if (!mediaId || typeof mediaId !== "string") {
      throw new Error("mediaId is required and must be a string");
    }

    const mediaIdTrimmed = mediaId.trim();
    if (mediaIdTrimmed.length === 0) {
      throw new Error("mediaId cannot be empty");
    }

    // Validate text
    if (!text || typeof text !== "string") {
      throw new Error("text is required and must be a string");
    }

    const textTrimmed = text.trim();
    if (textTrimmed.length === 0) {
      throw new Error("text cannot be empty");
    }

    // Validate text length (Instagram comment limit is 2200 characters)
    if (textTrimmed.length > 2200) {
      throw new Error(`Comment text exceeds maximum length of 2200 characters (current: ${textTrimmed.length})`);
    }

    // Validate replyToCommentId if provided
    if (replyToCommentId !== undefined) {
      if (typeof replyToCommentId !== "string") {
        throw new Error("replyToCommentId must be a string if provided");
      }
      const replyToCommentIdTrimmed = replyToCommentId.trim();
      if (replyToCommentIdTrimmed.length === 0) {
        throw new Error("replyToCommentId cannot be empty if provided");
      }
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
      // Prepare comment parameters
      const commentParams: any = {
        mediaId: mediaIdTrimmed,
        text: textTrimmed,
      };

      // Add replyToCommentId if provided
      if (replyToCommentId) {
        commentParams.replyToCommentId = replyToCommentId.trim();
      }

      // Call the API to comment on the post
      const comment = await client.media.comment(commentParams);

      // Format success response
      let response = `Successfully commented on post with media ID: ${mediaIdTrimmed}`;
      if (comment?.pk) {
        response += `. Comment ID: ${comment.pk}`;
      }
      if (replyToCommentId) {
        response += ` (reply to comment ${replyToCommentId.trim()})`;
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
          (errorMessage.includes("invalid") && errorMessage.includes("session"))
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

        // Comments disabled
        if (
          errorMessage.includes("comments disabled") ||
          errorMessage.includes("commenting is not allowed") ||
          errorMessage.includes("cannot comment") ||
          errorMessage.includes("not allowed to comment")
        ) {
          throw new Error(`Comments are disabled on this post (media ID: ${mediaIdTrimmed}).`);
        }

        // Rate limiting
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("too many requests") ||
          error?.response?.status === 429
        ) {
          throw new Error("Rate limit exceeded. Please wait before trying again.");
        }

        // Invalid comment text
        if (
          errorMessage.includes("invalid comment") ||
          errorMessage.includes("spam") ||
          errorMessage.includes("comment too long") ||
          errorMessage.includes("comment rejected")
        ) {
          throw new Error(`Invalid comment text. Please check your comment and try again.`);
        }

        // Comment not found (for replies)
        if (
          errorMessage.includes("comment not found") ||
          errorMessage.includes("invalid comment id") ||
          (errorMessage.includes("reply") && errorMessage.includes("not found"))
        ) {
          throw new Error(`Comment not found with ID "${replyToCommentId}". Please verify the comment ID is correct.`);
        }
      }

      // Re-throw other errors to be handled by base error handling
      throw error;
    }
  }
}

