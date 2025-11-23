/**
 * Instagram Get User Stories Tool
 * Retrieves active Instagram stories from a user
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetUserStoriesTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_get_user_stories",
      description: "Get active Instagram stories from a user by user ID or username. Returns story items with media URLs, timestamps, story type, duration, and viewer count (if viewing own stories). Stories expire after 24 hours.",
      inputSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Instagram user ID (numeric string). Either userId or username must be provided, but not both.",
          },
          username: {
            type: "string",
            description: "Instagram username (without @ symbol). Either userId or username must be provided, but not both.",
          },
        },
        required: [],
      },
    };
  }

  async execute(args: { userId?: string; username?: string }): Promise<ToolResult> {
    const { userId, username } = args;

    // Validate that exactly one parameter is provided
    if (!userId && !username) {
      throw new Error("Either userId or username must be provided. Please provide one of them.");
    }

    if (userId && username) {
      throw new Error("Both userId and username cannot be provided. Please provide only one of them.");
    }

    // Validate userId format if provided
    if (userId) {
      const userIdTrimmed = userId.trim();
      if (userIdTrimmed.length === 0) {
        throw new Error("userId cannot be empty");
      }
      // Check if it's a valid numeric string
      if (!/^\d+$/.test(userIdTrimmed)) {
        throw new Error("userId must be a numeric string");
      }
    }

    // Validate username format if provided
    if (username) {
      const usernameTrimmed = username.trim().replace(/^@/, ""); // Remove @ if present
      if (usernameTrimmed.length === 0) {
        throw new Error("username cannot be empty");
      }
      if (usernameTrimmed.length > 30) {
        throw new Error("username is too long (max 30 characters)");
      }
      // Basic username validation (alphanumeric, dots, underscores)
      if (!/^[a-zA-Z0-9._]+$/.test(usernameTrimmed)) {
        throw new Error("username contains invalid characters. Only letters, numbers, dots, and underscores are allowed.");
      }
    }

    // Ensure client is initialized
    if (!igpapiClient.isInitialized()) {
      await igpapiClient.initialize();
    }

    const client = igpapiClient.getClient();

    try {
      let targetUserId: string;

      // Resolve userId from username if needed
      if (username) {
        const usernameClean = username.trim().replace(/^@/, "");
        const userInfo = await client.user.usernameinfo(usernameClean);
        targetUserId = String(userInfo.pk);
      } else {
        targetUserId = userId!.trim();
      }

      // Create story feed instance
      const storyFeed = client.feed.userStory(targetUserId);

      // Fetch stories
      const stories = await storyFeed.items();

      // Format the response
      const formattedResponse = this.formatStoriesResponse(stories, targetUserId, username);

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

        // User not found
        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("user not found") ||
          errorMessage.includes("invalid user") ||
          error?.response?.status === 404
        ) {
          const identifier = userId ? `user ID "${userId}"` : `username "${username}"`;
          throw new Error(
            `User not found with ${identifier}. Please verify the user ID or username is correct.`
          );
        }

        // Private account
        if (
          errorMessage.includes("private") ||
          errorMessage.includes("not authorized") ||
          errorMessage.includes("forbidden") ||
          error?.response?.status === 403
        ) {
          const identifier = userId ? `user ID "${userId}"` : `username "${username}"`;
          const authNote = !igpapiClient.isLoggedIn()
            ? " This account is private. You may need to authenticate using the instagram_login tool and follow the account to view stories."
            : " This account is private. You may need to follow the account to view stories.";
          throw new Error(`Cannot access stories for ${identifier}.${authNote}`);
        }

        // Authentication required
        if (
          errorMessage.includes("login") ||
          errorMessage.includes("authentication") ||
          errorMessage.includes("unauthorized") ||
          error?.response?.status === 401
        ) {
          throw new Error(
            "Authentication required. Please use the instagram_login tool to authenticate first."
          );
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
          errorMessage.includes("invalid")
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
   * Format stories data into a readable string
   */
  private formatStoriesResponse(
    stories: any[],
    userId: string,
    username: string | undefined
  ): string {
    if (stories.length === 0) {
      const identifier = username ? `@${username}` : `User ID ${userId}`;
      return `No active stories found for ${identifier}.\n\nNote: Stories expire after 24 hours.`;
    }

    // Get username from first story if not provided
    const displayUsername = username || stories[0]?.user?.username || "unknown";
    const displayUserId = userId;

    let response = `Stories for @${displayUsername} (User ID: ${displayUserId}):\n`;
    response += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    response += `Showing ${stories.length} active story${stories.length === 1 ? "" : "s"}\n`;
    response += `⚠️ Note: Stories expire after 24 hours\n\n`;

    stories.forEach((story, index) => {
      const storyId = story.id || story.pk || "N/A";
      const mediaType = this.getStoryType(story);
      const timestamp = story.taken_at || story.created_time;
      const formattedDate = timestamp ? this.formatTimestamp(timestamp) : "N/A";
      const expiresAt = story.expiring_at || (timestamp ? timestamp + 86400 : null); // 24 hours = 86400 seconds
      const formattedExpiration = expiresAt ? this.formatTimestamp(expiresAt) : "N/A";

      // Viewer count (only available for own stories)
      const viewerCount = story.viewer_count || story.view_count || null;

      // Video duration
      const videoDuration = story.video_duration || null;

      // Get media URLs
      const mediaUrls = this.getMediaUrls(story, mediaType);

      response += `Story ${index + 1}:\n`;
      response += `Story ID: ${storyId}\n`;
      response += `Type: ${mediaType}\n`;

      if (mediaUrls.length > 0) {
        if (mediaUrls.length === 1) {
          response += `Media URL: ${mediaUrls[0]}\n`;
        } else {
          response += `Media URLs (${mediaUrls.length}):\n`;
          mediaUrls.forEach((url, i) => {
            response += `  ${i + 1}. ${url}\n`;
          });
        }
      }

      response += `Posted: ${formattedDate}\n`;
      response += `Expires: ${formattedExpiration}\n`;

      if (videoDuration !== null) {
        response += `Duration: ${videoDuration} seconds\n`;
      }

      if (viewerCount !== null) {
        response += `Viewers: ${viewerCount.toLocaleString()}\n`;
      }

      // Story stickers/interactive elements
      const storyStickers = story.story_stickers || story.stickers || [];
      if (storyStickers.length > 0) {
        const stickerTypes: string[] = [];
        storyStickers.forEach((sticker: any) => {
          if (sticker.poll_sticker) stickerTypes.push("Poll");
          if (sticker.question_sticker) stickerTypes.push("Question");
          if (sticker.slider_sticker) stickerTypes.push("Slider");
          if (sticker.quiz_sticker) stickerTypes.push("Quiz");
          if (sticker.countdown_sticker) stickerTypes.push("Countdown");
        });
        if (stickerTypes.length > 0) {
          response += `Interactive Elements: ${stickerTypes.join(", ")}\n`;
        }
      }

      response += "\n";
    });

    return response;
  }

  /**
   * Determine story type from story object
   */
  private getStoryType(story: any): string {
    if (story.media_type === 1 || story.type === "photo") {
      return "Photo";
    } else if (story.media_type === 2 || story.type === "video") {
      return "Video";
    } else if (story.media_type === 3 || story.type === "reel") {
      return "Reel";
    }
    return "Unknown";
  }

  /**
   * Extract media URLs from story object
   */
  private getMediaUrls(story: any, mediaType: string): string[] {
    const urls: string[] = [];

    if (mediaType === "Video" || mediaType === "Reel") {
      // Video stories
      if (story.video_versions && story.video_versions.length > 0) {
        const highestQuality = story.video_versions[story.video_versions.length - 1];
        if (highestQuality?.url) {
          urls.push(highestQuality.url);
        }
      }
      // Also include cover/thumbnail image
      if (story.image_versions2?.candidates) {
        const candidates = story.image_versions2.candidates;
        const highestRes = candidates[candidates.length - 1];
        if (highestRes?.url) {
          urls.push(highestRes.url);
        }
      }
    } else {
      // Photo stories
      if (story.image_versions2?.candidates) {
        const candidates = story.image_versions2.candidates;
        const highestRes = candidates[candidates.length - 1];
        if (highestRes?.url) {
          urls.push(highestRes.url);
        }
      } else if (story.images) {
        // Fallback to images object
        if (story.images.standard_resolution?.url) {
          urls.push(story.images.standard_resolution.url);
        }
      }
    }

    return urls;
  }

  /**
   * Format timestamp to readable date string
   */
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp * 1000); // Instagram timestamps are in seconds
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

