/**
 * Instagram Get Current User Profile Tool
 * Retrieves the authenticated user's own profile information
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetCurrentUserProfileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_get_current_user_profile",
      description: "Get the authenticated user's own profile information. Returns complete account details including username, full name, bio, follower/following counts, verification status, profile picture, account type, and settings. Requires authentication.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    // Check if user is logged in
    if (!igpapiClient.isLoggedIn()) {
      throw new Error("Not logged in. Please use the instagram_login tool to authenticate first.");
    }

    // Ensure client is initialized
    if (!igpapiClient.isInitialized()) {
      await igpapiClient.initialize();
    }

    try {
      // Get current user profile
      const userInfo = await igpapiClient.getCurrentUser();

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
        
        // Authentication errors
        if (errorMessage.includes("not logged in") || 
            errorMessage.includes("login") ||
            errorMessage.includes("authentication") ||
            errorMessage.includes("unauthorized") ||
            error?.response?.status === 401) {
          throw new Error("Authentication required. Please use the instagram_login tool to authenticate first.");
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
    
    // Additional fields available for own account
    const email = user.email || null;
    const phoneNumber = user.phone_number || null;

    // Determine account type
    let accountType = "Personal";
    if (isBusinessAccount) {
      accountType = "Business";
    } else if (isProfessionalAccount) {
      accountType = "Professional";
    }

    // Build response
    let response = `Your Profile Information:\n`;
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

    // Add account details (only available for own account)
    if (email) {
      response += `\nEmail: ${email}\n`;
    }
    if (phoneNumber) {
      response += `Phone Number: ${phoneNumber}\n`;
    }

    return response;
  }
}

