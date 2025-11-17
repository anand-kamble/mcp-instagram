/**
 * Instagram Get User Profile Tool
 * Retrieves comprehensive profile information by user ID or username
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetUserProfileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_get_user_profile",
      description: "Get comprehensive Instagram profile information by user ID or username. Returns profile details including username, full name, bio, follower/following counts, verification status, profile picture, and account type flags.",
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
      let userInfo: any;

      // Call appropriate API method based on input
      if (userId) {
        const userIdNum = userId.trim();
        userInfo = await client.user.info(userIdNum);
      } else if (username) {
        const usernameClean = username.trim().replace(/^@/, "");
        userInfo = await client.user.usernameinfo(usernameClean);
      }

      // Format the response
      const profile = this.formatProfileResponse(userInfo);

      return {
        content: [
          {
            type: "text",
            text: profile,
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
            ? " This profile is private. You may need to authenticate using the instagram_login tool and follow the account to view it."
            : " This profile is private. You may need to follow the account to view it.";
          throw new Error(`Cannot access profile with ${identifier}.${authNote}`);
        }

        // Authentication required
        if (errorMessage.includes("login") || 
            errorMessage.includes("authentication") ||
            errorMessage.includes("unauthorized") ||
            error?.response?.status === 401) {
          throw new Error("Authentication required. Please use the instagram_login tool to authenticate first.");
        }
      }

      // Re-throw other errors to be handled by base error handling
      throw error;
    }
  }

  /**
   * Format user profile data into a readable string
   */
  private formatProfileResponse(user: any): string {
    const username = user.username || "N/A";
    const fullName = user.full_name || "N/A";
    const userId = user.pk || user.id || "N/A";
    const bio = user.biography || "";
    const profilePicUrl = user.profile_pic_url || user.profile_pic_url_hd || "N/A";
    const profilePicUrlHd = user.profile_pic_url_hd || profilePicUrl;
    const externalUrl = user.external_url || null;

    const followerCount = user.follower_count || user.edge_followed_by?.count || 0;
    const followingCount = user.following_count || user.edge_follow?.count || 0;
    const mediaCount = user.media_count || user.edge_owner_to_timeline_media?.count || 0;

    const isVerified = user.is_verified || false;
    const isPrivate = user.is_private || false;
    const isBusinessAccount = user.is_business_account || false;
    const isProfessionalAccount = user.is_professional_account || false;
    const category = user.category || user.business_category_name || null;
    const publicEmail = user.public_email || null;
    const contactPhoneNumber = user.contact_phone_number || null;

    // Determine account type
    let accountType = "Personal";
    if (isBusinessAccount) {
      accountType = "Business";
    } else if (isProfessionalAccount) {
      accountType = "Professional";
    }

    // Build response
    let response = `Profile Information for @${username}:\n`;
    response += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
    response += `Username: @${username}\n`;
    response += `Full Name: ${fullName}\n`;
    response += `User ID: ${userId}\n`;

    if (bio) {
      response += `Bio: ${bio}\n`;
    }

    response += `\nProfile Picture: ${profilePicUrlHd}\n`;

    if (externalUrl) {
      response += `External URL: ${externalUrl}\n`;
    }

    response += `\nStatistics:\n`;
    response += `• Followers: ${followerCount.toLocaleString()}\n`;
    response += `• Following: ${followingCount.toLocaleString()}\n`;
    response += `• Posts: ${mediaCount.toLocaleString()}\n`;

    response += `\nAccount Type: ${accountType}`;
    if (category) {
      response += ` (${category})`;
    }
    response += `\n`;

    response += `Verification: ${isVerified ? "✓ Verified" : "Not verified"}\n`;
    response += `Privacy: ${isPrivate ? "🔒 Private" : "🌐 Public"}\n`;

    // Add business-specific information
    if (isBusinessAccount || isProfessionalAccount) {
      if (publicEmail) {
        response += `\nPublic Email: ${publicEmail}\n`;
      }
      if (contactPhoneNumber) {
        response += `Contact Phone: ${contactPhoneNumber}\n`;
      }
    }

    return response;
  }
}

