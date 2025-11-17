/**
 * Instagram Get User Posts Feed Tool
 * Retrieves paginated feed of a user's Instagram posts
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetUserPostsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_get_user_posts",
      description: "Get paginated feed of a user's Instagram posts. Returns posts with media URLs, captions, engagement metrics, and metadata. Supports pagination via maxId cursor.",
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
          maxId: {
            type: "string",
            description: "Pagination cursor for fetching next page. Use the maxId from previous response to get next page.",
          },
          limit: {
            type: "number",
            description: "Number of posts to fetch per page (default: 12, max: 50)",
            default: 12,
          },
        },
        required: [],
      },
    };
  }

  async execute(args: { userId?: string; username?: string; maxId?: string; limit?: number }): Promise<ToolResult> {
    const { userId, username, maxId, limit = 12 } = args;

    // Validate that exactly one of userId or username is provided
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

    // Validate limit
    const postLimit = Math.min(Math.max(1, limit || 12), 50);

    // Validate maxId if provided
    if (maxId !== undefined && maxId !== null) {
      if (typeof maxId !== "string" || maxId.trim().length === 0) {
        throw new Error("maxId must be a non-empty string if provided");
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

      // Create feed instance
      const feed = client.feed.user(targetUserId);

      // Set pagination cursor if provided
      if (maxId) {
        (feed as any).maxId = maxId.trim();
      }

      // Fetch posts using feed.items() method
      const posts: any[] = [];
      let nextMaxId: string | undefined;
      let hasMore = false;
      let fetchedCount = 0;

      // Fetch items from feed
      const items = await feed.items();
      
      // Process items up to the limit
      for (const item of items) {
        if (fetchedCount >= postLimit) {
          break;
        }
        posts.push(item);
        fetchedCount++;
      }

      // Check if there's more available and get next maxId
      if (feed.isMoreAvailable()) {
        hasMore = true;
        nextMaxId = (feed as any).maxId;
      }

      // Format the response
      const formattedResponse = this.formatPostsResponse(posts, targetUserId, username, postLimit, nextMaxId, hasMore);

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
        if (errorMessage.includes("not found") || 
            errorMessage.includes("user not found") ||
            errorMessage.includes("invalid user") ||
            error?.response?.status === 404) {
          const identifier = userId ? `user ID "${userId}"` : `username "${username}"`;
          throw new Error(`User not found with ${identifier}. Please verify the user ID or username is correct.`);
        }

        // Private account
        if (errorMessage.includes("private") || 
            errorMessage.includes("not authorized") ||
            error?.response?.status === 403) {
          const identifier = userId ? `user ID "${userId}"` : `username "${username}"`;
          const authNote = !igpapiClient.isLoggedIn() 
            ? " This account is private. You may need to authenticate using the instagram_login tool and follow the account to view posts."
            : " This account is private. You may need to follow the account to view posts.";
          throw new Error(`Cannot access posts for ${identifier}.${authNote}`);
        }

        // Authentication required
        if (errorMessage.includes("login") || 
            errorMessage.includes("authentication") ||
            errorMessage.includes("unauthorized") ||
            error?.response?.status === 401) {
          throw new Error("Authentication required. Please use the instagram_login tool to authenticate first.");
        }

        // Rate limiting
        if (errorMessage.includes("rate limit") || 
            errorMessage.includes("too many requests") ||
            error?.response?.status === 429) {
          throw new Error("Rate limit exceeded. Please wait before trying again.");
        }

        // Session expired
        if (errorMessage.includes("session") || 
            errorMessage.includes("expired") ||
            errorMessage.includes("invalid")) {
          throw new Error("Session has expired. Please use the instagram_login tool to re-authenticate.");
        }
      }

      // Re-throw other errors to be handled by base error handling
      throw error;
    }
  }

  /**
   * Format posts feed data into a readable string
   */
  private formatPostsResponse(
    posts: any[],
    userId: string,
    username: string | undefined,
    limit: number,
    nextMaxId: string | undefined,
    hasMore: boolean
  ): string {
    if (posts.length === 0) {
      const identifier = username ? `@${username}` : `User ID ${userId}`;
      return `No posts found for ${identifier}.`;
    }

    // Get username from first post if not provided
    const displayUsername = username || posts[0]?.user?.username || "unknown";
    const displayUserId = userId;

    let response = `Posts Feed for @${displayUsername} (User ID: ${displayUserId}):\n`;
    response += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    response += `Showing ${posts.length} post${posts.length === 1 ? "" : "s"}\n\n`;

    posts.forEach((post, index) => {
      const mediaId = post.id || post.pk || "N/A";
      const mediaType = this.getMediaType(post);
      const caption = post.caption?.text || post.caption || "";
      const captionPreview = caption.length > 200 ? caption.substring(0, 200) + "..." : caption;
      
      const likesCount = post.like_count || post.likes?.count || 0;
      const commentsCount = post.comment_count || post.comments?.count || 0;
      
      const timestamp = post.taken_at || post.created_time;
      const formattedDate = timestamp ? this.formatTimestamp(timestamp) : "N/A";
      
      const authorUsername = post.user?.username || displayUsername;
      
      // Get media URLs
      const mediaUrls = this.getMediaUrls(post, mediaType);

      response += `Post ${index + 1}:\n`;
      response += `Media ID: ${mediaId}\n`;
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
      
      if (captionPreview) {
        response += `Caption: ${captionPreview}\n`;
      }
      
      response += `Likes: ${likesCount.toLocaleString()} | Comments: ${commentsCount.toLocaleString()}\n`;
      response += `Posted: ${formattedDate}\n`;
      response += `Author: @${authorUsername}\n`;
      
      // Add location if available
      if (post.location) {
        const locationName = post.location.name || "Unknown location";
        response += `Location: ${locationName}\n`;
      }
      
      response += "\n";
    });

    // Add pagination info
    if (hasMore && nextMaxId) {
      response += `Pagination: Use maxId="${nextMaxId}" to fetch next page\n`;
    } else if (hasMore) {
      response += `Pagination: More posts available. Use maxId from next request to continue.\n`;
    } else {
      response += `Pagination: No more posts available.\n`;
    }

    return response;
  }

  /**
   * Determine media type from post object
   */
  private getMediaType(post: any): string {
    if (post.media_type === 1 || post.type === "photo") {
      return "Photo";
    } else if (post.media_type === 2 || post.type === "video") {
      return "Video";
    } else if (post.media_type === 8 || post.type === "carousel" || post.carousel_media) {
      return "Carousel";
    }
    return "Unknown";
  }

  /**
   * Extract media URLs from post object
   */
  private getMediaUrls(post: any, mediaType: string): string[] {
    const urls: string[] = [];

    if (mediaType === "Carousel" && post.carousel_media) {
      // Carousel posts have multiple media items
      post.carousel_media.forEach((item: any) => {
        if (item.image_versions2?.candidates) {
          // Get highest resolution image
          const candidates = item.image_versions2.candidates;
          const highestRes = candidates[candidates.length - 1];
          if (highestRes?.url) {
            urls.push(highestRes.url);
          }
        } else if (item.video_versions) {
          // Get highest quality video
          const videos = item.video_versions;
          const highestQuality = videos[videos.length - 1];
          if (highestQuality?.url) {
            urls.push(highestQuality.url);
          }
        }
      });
    } else if (mediaType === "Video") {
      // Video posts
      if (post.video_versions && post.video_versions.length > 0) {
        const highestQuality = post.video_versions[post.video_versions.length - 1];
        if (highestQuality?.url) {
          urls.push(highestQuality.url);
        }
      }
      // Also include cover image
      if (post.image_versions2?.candidates) {
        const candidates = post.image_versions2.candidates;
        const highestRes = candidates[candidates.length - 1];
        if (highestRes?.url) {
          urls.push(highestRes.url);
        }
      }
    } else {
      // Photo posts
      if (post.image_versions2?.candidates) {
        const candidates = post.image_versions2.candidates;
        const highestRes = candidates[candidates.length - 1];
        if (highestRes?.url) {
          urls.push(highestRes.url);
        }
      } else if (post.images) {
        // Fallback to images object
        if (post.images.standard_resolution?.url) {
          urls.push(post.images.standard_resolution.url);
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

