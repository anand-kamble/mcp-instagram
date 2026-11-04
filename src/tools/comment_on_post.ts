/**
 * instagram_comment_on_post: posts a comment, or a reply to a comment.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { mediaIdInput } from "./shared/schemas.js";
import { consumeRateLimit } from "../utils/index.js";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { compact } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

const MAX_COMMENT_LENGTH = 2200;

export function registerCommentOnPost(server: McpServer): void {
  server.registerTool(
    "instagram_comment_on_post",
    {
      title: "Comment on a post",
      description:
        "Post a comment on an Instagram post, or reply to an existing comment, as the logged-in account. " +
        "Every call publishes a new public comment, so never retry blindly and only comment when the user asked. " +
        "Returns the new comment's ID.",
      inputSchema: z.object({
        mediaId: mediaIdInput,
        text: z
          .string()
          .min(1)
          .max(MAX_COMMENT_LENGTH)
          .refine((value) => value.trim().length > 0, "text cannot be blank")
          .describe(`Comment text (max ${MAX_COMMENT_LENGTH} characters)`),
        replyToCommentId: z
          .string()
          .regex(/^\d{1,40}$/, "replyToCommentId must be a numeric string")
          .optional()
          .describe("ID of the comment to reply to, from instagram_get_post_comments"),
      }),
      outputSchema: z.object({
        commentId: z.string().optional().describe("ID of the new comment"),
        mediaId: z.string(),
        replyToCommentId: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ mediaId, text, replyToCommentId }) => {
      const client = await getLoggedInClient();
      consumeRateLimit("comment");
      let commentId: string | undefined;
      try {
        const comment = await client.media.comment({
          mediaId,
          text: text.trim(),
          ...(replyToCommentId ? { replyToCommentId } : {}),
        });
        commentId = comment?.pk ? String(comment.pk) : undefined;
      } catch (error) {
        throw toToolError(error, `media ${mediaId}`);
      }
      return structuredResult(compact({ commentId, mediaId, replyToCommentId }));
    }
  );
}
