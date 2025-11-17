/**
 * Instagram Account Search Tool
 * Allows searching for Instagram accounts by username query
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";
import type { UserRepositorySearchResponseRootObject } from "instagram-private-api";

export class SearchAccountsTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "instagram_search_accounts",
      description: "Search for Instagram accounts by username query. Returns a list of matching accounts with their profile information.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (username or name to search for)",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default: 20, max: 50)",
            default: 20,
          },
        },
        required: ["query"],
      },
    };
  }

  async execute(args: { query: string; limit?: number }): Promise<ToolResult> {
    const { query, limit = 20 } = args;

    // Validate inputs
    if (!query || query.trim().length === 0) {
      throw new Error("Search query is required and cannot be empty");
    }

    const searchLimit = Math.min(Math.max(1, limit || 20), 50);

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
      // Perform account search
      const searchResponse = await client.user.search(query) as UserRepositorySearchResponseRootObject;

      // Extract users array from response
      // The response structure contains a 'users' property with the array of results
      const users = searchResponse.users || [];
      const totalResults = users.length;

      // Limit results
      const limitedResults = users.slice(0, searchLimit);

      // Format results
      if (limitedResults.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No accounts found matching "${query}"`,
            },
          ],
        };
      }

      const formattedResults = limitedResults.map((user, index: number) => {
        const profile = {
          rank: index + 1,
          username: user.username || "N/A",
          fullName: user.full_name || "N/A",
          userId: user.pk || "N/A",
          isVerified: user.is_verified || false,
          isPrivate: user.is_private || false,
          followerCount: user.follower_count || 0,
        };

        return `\n${profile.rank}. @${profile.username}${profile.isVerified ? " ✓" : ""}
   Full Name: ${profile.fullName}
   User ID: ${profile.userId}
   ${profile.isPrivate ? "🔒 Private Account" : "🌐 Public Account"}
   Followers: ${profile.followerCount.toLocaleString()}`;
      }).join("\n");

      const summary = `Found ${limitedResults.length} account${limitedResults.length === 1 ? "" : "s"} matching "${query}"${totalResults > searchLimit ? ` (showing first ${searchLimit} of ${totalResults} total)` : ""}:`;

      return {
        content: [
          {
            type: "text",
            text: `${summary}${formattedResults}`,
          },
        ],
      };
    } catch (error) {
      // Re-throw to be handled by base error handling
      throw error;
    }
  }
}

