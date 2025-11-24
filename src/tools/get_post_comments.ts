/**
 * Instagram Get Post Comments Tool
 * Retrieves paginated comments for an Instagram post
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetPostCommentsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_get_post_comments",
      description: "Get comments for an Instagram post. Returns paginated list of comments with author info, text, timestamps, and engagement metrics. Supports pagination via maxId cursor. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {
          mediaId: {
            type: "string",
            description: "Post/media ID to get comments for",
          },
          maxId: {
            type: "string",
            description: "Pagination cursor for fetching next page. Use the maxId from previous response to get next page.",
          },
          limit: {
            type: "number",
            description: "Number of comments to fetch per page (default: 12, max: 50)",
            default: 12,
          },
        },
        required: ["mediaId"],
      },
    };
  }

  async execute(args: { mediaId: string; maxId?: string; limit?: number }): Promise<ToolResult> {
    const { mediaId, maxId, limit = 12 } = args;

    // Validate mediaId
    if (typeof mediaId !== "string") {
      throw new Error("mediaId is required and must be a string");
    }

    const mediaIdTrimmed = mediaId.trim();
    if (mediaIdTrimmed.length === 0) {
      throw new Error("mediaId cannot be empty");
    }

    // Validate limit
    const commentLimit = Math.min(Math.max(1, limit || 12), 50);

    // Validate maxId if provided
    if (maxId !== undefined && maxId !== null) {
      if (typeof maxId !== "string" || maxId.trim().length === 0) {
        throw new Error("maxId must be a non-empty string if provided");
      }
    }

    // Check if logged in (required for comments feed)
    if (!igpapiClient.isLoggedIn()) {
      throw new Error(
        "Not logged in. Please use the instagram_login tool to authenticate first."
      );
    }

    // Ensure client is initialized
    if (!igpapiClient.isInitialized()) {
      await igpapiClient.initialize();
    }

    const client = igpapiClient.getClient();

    try {
      // Create media comments feed instance
      const feed = client.feed.mediaComments(mediaIdTrimmed);

      // Set pagination cursor if provided
      if (maxId) {
        (feed as any).maxId = maxId.trim();
      }

      // Fetch comments using feed.items() method
      const comments: any[] = [];
      let nextMaxId: string | undefined;
      let hasMore = false;
      let fetchedCount = 0;

      // Fetch items from feed
      const items = await feed.items();

      // Process items up to the limit
      for (const item of items) {
        if (fetchedCount >= commentLimit) {
          break;
        }
        comments.push(item);
        fetchedCount++;
      }

      // Check if there's more available and get next maxId
      if (feed.isMoreAvailable()) {
        hasMore = true;
        nextMaxId = (feed as any).maxId;
      }

      // Format the response
      const formattedResponse = this.formatCommentsResponse(
        comments,
        mediaIdTrimmed,
        commentLimit,
        nextMaxId,
        hasMore
      );

      return {
        content: [
          {
            type: "text",
            text: formattedResponse,
          },
        ],
      };
    } catch (error: any) {
      // Handle specific error cases
      if (error?.message) {
        const errorMessage = error.message.toLowerCase();

        // Authentication required
        if (
          errorMessage.includes("login") ||
          errorMessage.includes("authentication") ||
          errorMessage.includes("unauthorized") ||
          errorMessage.includes("not logged in") ||
          error?.response?.status === 401
        ) {
          throw new Error(
            "Authentication required. Please use the instagram_login tool to authenticate first."
          );
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

        // Session expired
        if (
          errorMessage.includes("session") ||
          errorMessage.includes("expired") ||
          (errorMessage.includes("invalid") && errorMessage.includes("session"))
        ) {
          throw new Error(
            "Session has expired. Please use the instagram_login tool to re-authenticate."
          );
        }
      }

      // Re-throw other errors to be handled by base error handling
      throw error;
    }
  }

  /**
   * Format comments feed data into a readable string
   */
  private formatCommentsResponse(
    comments: any[],
    mediaId: string,
    limit: number,
    nextMaxId: string | undefined,
    hasMore: boolean
  ): string {
    if (comments.length === 0) {
      return `No comments found for post with media ID: ${mediaId}.\n\nThis may happen if:\n• The post has no comments yet\n• Comments are disabled on this post\n• The post is from a private account you don't have access to`;
    }

    let response = `Comments for Post (Media ID: ${mediaId}):\n`;
    response += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    response += `Showing ${comments.length} comment${comments.length === 1 ? "" : "s"}\n\n`;

    comments.forEach((comment, index) => {
      const commentId = comment.pk || comment.id || "N/A";
      const text = comment.text || "";
      const likeCount = comment.like_count || comment.likes?.count || 0;
      const parentCommentId = comment.parent_comment_id || null;

      const timestamp = comment.created_at || comment.created_time || comment.timestamp;
      const formattedDate = timestamp ? this.formatTimestamp(timestamp) : "N/A";

      const author = comment.user || {};
      const authorUsername = author.username || "unknown";
      const authorId = author.pk || author.id || "N/A";
      const authorFullName = author.full_name || "";

      response += `Comment ${index + 1}:\n`;
      response += `Comment ID: ${commentId}\n`;

      // Author information
      let authorInfo = `Author: @${authorUsername} (ID: ${authorId})`;
      if (authorFullName) {
        authorInfo += ` - ${authorFullName}`;
      }
      response += `${authorInfo}\n`;

      // Comment text
      if (text) {
        response += `Text: ${text}\n`;
      } else {
        response += `Text: (no text)\n`;
      }

      // Engagement metrics
      response += `Likes: ${likeCount.toLocaleString()}\n`;

      // Timestamp
      response += `Posted: ${formattedDate}\n`;

      // Reply indicator
      if (parentCommentId) {
        response += `Reply to comment ID: ${parentCommentId}\n`;
      }

      response += "\n";
    });

    // Add pagination info
    if (hasMore && nextMaxId) {
      response += `Pagination: Use maxId="${nextMaxId}" to fetch next page\n`;
    } else if (hasMore) {
      response += `Pagination: More comments available. Use maxId from next request to continue.\n`;
    } else {
      response += `Pagination: No more comments available.\n`;
    }

    return response;
  }

  /**
   * Format timestamp to readable date string
   */
  private formatTimestamp(timestamp: number | string): string {
    // Handle both Unix timestamp (seconds) and ISO string
    let date: Date;
    if (typeof timestamp === "number") {
      // Instagram timestamps are typically in seconds
      date = new Date(timestamp * 1000);
    } else {
      date = new Date(timestamp);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return "N/A";
    }

    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
}

