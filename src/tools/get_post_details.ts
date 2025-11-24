/**
 * Instagram Get Post Details Tool
 * Retrieves detailed information about a specific Instagram post by media ID
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetPostDetailsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_get_post_details",
      description: "Get detailed information about a specific Instagram post by media ID. Returns comprehensive post details including caption, engagement metrics, media URLs, dimensions, location, and author information.",
      inputSchema: {
        type: "object",
        properties: {
          mediaId: {
            type: "string",
            description: "Post/media ID to retrieve details for",
          },
        },
        required: ["mediaId"],
      },
    };
  }

  async execute(args: { mediaId: string }): Promise<ToolResult> {
    const { mediaId } = args;

    // Validate mediaId
    if (typeof mediaId !== "string") {
      throw new Error("mediaId is required and must be a string");
    }

    const mediaIdTrimmed = mediaId.trim();
    if (mediaIdTrimmed.length === 0) {
      throw new Error("mediaId cannot be empty");
    }

    // Ensure client is initialized
    if (!igpapiClient.isInitialized()) {
      await igpapiClient.initialize();
    }

    const client = igpapiClient.getClient();

    try {
      // Call the API to get media info
      const mediaInfo = await client.media.info(mediaIdTrimmed);

      // Format the response
      const formattedResponse = this.formatPostDetailsResponse(mediaInfo);

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

        // Media not found
        if (
          errorMessage.includes("not found") ||
          errorMessage.includes("invalid media") ||
          errorMessage.includes("media not found") ||
          error?.response?.status === 404
        ) {
          throw new Error(
            `Media not found with ID "${mediaIdTrimmed}". Please verify the media ID is correct.`
          );
        }

        // Private account / not authorized
        if (
          errorMessage.includes("private") ||
          errorMessage.includes("not authorized") ||
          errorMessage.includes("forbidden") ||
          error?.response?.status === 403
        ) {
          const authNote = !igpapiClient.isLoggedIn()
            ? " This post may be from a private account. You may need to authenticate using the instagram_login tool and follow the account to view it."
            : " This post may be from a private account. You may need to follow the account to view it.";
          throw new Error(
            `Cannot access post with media ID "${mediaIdTrimmed}".${authNote}`
          );
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
   * Format post details data into a readable string
   */
  private formatPostDetailsResponse(media: any): string {
    const mediaId = media.id || media.pk || "N/A";
    const mediaType = this.getMediaType(media);
    const caption = media.caption?.text || media.caption || "";
    const likesCount = media.like_count || media.likes?.count || 0;
    const commentsCount = media.comment_count || media.comments?.count || 0;
    const viewCount = media.view_count || media.video_view_count || null;

    const timestamp = media.taken_at || media.created_time;
    const formattedDate = timestamp ? this.formatTimestamp(timestamp) : "N/A";

    const author = media.user || {};
    const authorUsername = author.username || "N/A";
    const authorId = author.pk || author.id || "N/A";
    const authorFullName = author.full_name || "N/A";
    const authorProfilePic = author.profile_pic_url || author.profile_pic_url_hd || "N/A";

    const location = media.location || null;
    const width = media.original_width || media.width || null;
    const height = media.original_height || media.height || null;

    // Get media URLs
    const mediaUrls = this.getMediaUrls(media, mediaType);

    // Build response
    let response = `Post Details for Media ID: ${mediaId}\n`;
    response += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

    // Author information
    response += `Author: @${authorUsername}\n`;
    response += `Author Name: ${authorFullName}\n`;
    response += `Author ID: ${authorId}\n`;
    response += `Author Profile Picture: ${authorProfilePic}\n\n`;

    // Media information
    response += `Media Type: ${mediaType}\n`;
    if (width && height) {
      response += `Dimensions: ${width} × ${height} pixels\n`;
    }

    // Media URLs
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

    // Caption
    if (caption) {
      response += `\nCaption:\n${caption}\n`;
    }

    // Engagement metrics
    response += `\nEngagement Metrics:\n`;
    response += `• Likes: ${likesCount.toLocaleString()}\n`;
    response += `• Comments: ${commentsCount.toLocaleString()}\n`;
    if (viewCount !== null) {
      response += `• Views: ${viewCount.toLocaleString()}\n`;
    }

    // Location
    if (location) {
      const locationName = location.name || "Unknown location";
      const locationId = location.pk || location.id || null;
      response += `\nLocation: ${locationName}`;
      if (locationId) {
        response += ` (ID: ${locationId})`;
      }
      response += `\n`;
    }

    // Timestamp
    response += `\nPosted: ${formattedDate}\n`;

    // Additional metadata
    const hasHashtags = caption && caption.includes("#");
    const hasMentions = caption && caption.includes("@");
    if (hasHashtags || hasMentions) {
      response += `\nAdditional Info:\n`;
      if (hasHashtags) {
        response += `• Contains hashtags\n`;
      }
      if (hasMentions) {
        response += `• Contains mentions\n`;
      }
    }

    return response;
  }

  /**
   * Determine media type from media object
   */
  private getMediaType(media: any): string {
    if (media.media_type === 1 || media.type === "photo") {
      return "Photo";
    } else if (media.media_type === 2 || media.type === "video") {
      return "Video";
    } else if (media.media_type === 8 || media.type === "carousel" || media.carousel_media) {
      return "Carousel";
    }
    return "Unknown";
  }

  /**
   * Extract media URLs from media object
   */
  private getMediaUrls(media: any, mediaType: string): string[] {
    const urls: string[] = [];

    if (mediaType === "Carousel" && media.carousel_media) {
      // Carousel posts have multiple media items
      media.carousel_media.forEach((item: any) => {
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
      // Video posts - include video URL
      if (media.video_versions && media.video_versions.length > 0) {
        const highestQuality = media.video_versions[media.video_versions.length - 1];
        if (highestQuality?.url) {
          urls.push(highestQuality.url);
        }
      }
      // Also include cover/thumbnail image
      if (media.image_versions2?.candidates) {
        const candidates = media.image_versions2.candidates;
        const highestRes = candidates[candidates.length - 1];
        if (highestRes?.url) {
          urls.push(highestRes.url);
        }
      }
    } else {
      // Photo posts
      if (media.image_versions2?.candidates) {
        const candidates = media.image_versions2.candidates;
        const highestRes = candidates[candidates.length - 1];
        if (highestRes?.url) {
          urls.push(highestRes.url);
        }
      } else if (media.images) {
        // Fallback to images object
        if (media.images.standard_resolution?.url) {
          urls.push(media.images.standard_resolution.url);
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

