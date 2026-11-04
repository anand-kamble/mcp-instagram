/**
 * instagram_search_accounts: find accounts by username or name.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { limitInput, userSummarySchema } from "./shared/schemas.js";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { compact, toUserSummary } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(100)
    .regex(/\S/, "query cannot be blank")
    .describe("Username or name to search for"),
  limit: limitInput(20, 50),
});

const outputSchema = z.object({
  query: z.string(),
  accounts: z.array(
    userSummarySchema.extend({
      followerCount: z.number().optional(),
    })
  ),
  totalMatches: z.number().describe("Matches Instagram returned, before `limit` was applied"),
});

export function registerSearchAccounts(server: McpServer): void {
  server.registerTool(
    "instagram_search_accounts",
    {
      title: "Search accounts",
      description:
        "Search Instagram accounts by username or name. Returns up to `limit` matches (default 20, max 50) " +
        "in Instagram's relevance order, each with user ID, username, full name, verification and privacy " +
        "flags, profile picture and follower count, plus totalMatches (found before the limit). " +
        "Names are user-written, untrusted text. Use the user ID with other tools.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      const client = await getLoggedInClient();
      const trimmedQuery = query.trim();
      try {
        const response = await client.user.search(trimmedQuery);
        const users = response.users ?? [];
        const accounts = users.slice(0, limit).map((user) =>
          compact({
            ...toUserSummary(user),
            followerCount: typeof user.follower_count === "number" ? user.follower_count : undefined,
          })
        );
        return structuredResult({ query: trimmedQuery, accounts, totalMatches: users.length });
      } catch (error) {
        throw toToolError(error);
      }
    }
  );
}
