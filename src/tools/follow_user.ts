/**
 * instagram_follow_user: follows a user, or sends a follow request to a
 * private account.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { userIdInput } from "./shared/schemas.js";
import { consumeRateLimit } from "../utils/index.js";
import { getLoggedInApi, toToolError } from "./shared/instagram.js";
import { structuredResult } from "./shared/results.js";

export function registerFollowUser(server: McpServer): void {
  server.registerTool(
    "instagram_follow_user",
    {
      title: "Follow a user",
      description:
        "Follow an Instagram user by numeric user ID as the logged-in account (find IDs with instagram_search_accounts " +
        "or instagram_get_user_profile). For private accounts this sends a follow request. This is a public action; " +
        "only call it when the user asked for it.",
      inputSchema: z.object({ userId: userIdInput }),
      outputSchema: z.object({
        userId: z.string(),
        following: z.boolean().describe("True when the account is now followed"),
        requested: z.boolean().describe("True when a follow request awaits approval (private account)"),
        isPrivate: z.boolean().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ userId }) => {
      const api = await getLoggedInApi();
      consumeRateLimit("follow");
      try {
        const status = await api.follow(userId);
        return structuredResult({
          userId,
          following: Boolean(status?.following),
          requested: Boolean(status?.outgoing_request),
          ...(typeof status?.is_private === "boolean" ? { isPrivate: status.is_private } : {}),
        });
      } catch (error) {
        throw toToolError(error, `user ID ${userId}`);
      }
    }
  );
}
