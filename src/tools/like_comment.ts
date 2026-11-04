/**
 * instagram_like_comment: likes a comment as the logged-in account.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { consumeRateLimit } from "../utils/index.js";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";

export function registerLikeComment(server: McpServer): void {
  server.registerTool(
    "instagram_like_comment",
    {
      title: "Like a comment",
      description:
        "Like a comment on an Instagram post as the logged-in account. This is a public action on the user's real " +
        "account; only call it when the user asked for it. Comment IDs come from instagram_get_post_comments.",
      inputSchema: z.object({
        commentId: z
          .string()
          .regex(/^\d{1,40}$/, "commentId must be a numeric string")
          .describe("Comment ID, as returned by instagram_get_post_comments"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ commentId }) => {
      const client = await getLoggedInClient();
      consumeRateLimit("like");
      try {
        await client.media.likeComment(commentId);
      } catch (error) {
        throw toToolError(error, `comment ${commentId}`);
      }
      return textResult(`Liked comment ${commentId}.`);
    }
  );
}
