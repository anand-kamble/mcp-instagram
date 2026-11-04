/**
 * instagram_get_post_details: full details of a single post.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { mediaIdInput, mediaSummarySchema } from "./shared/schemas.js";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { compact, toMediaSummary } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

const inputSchema = z.object({
  mediaId: mediaIdInput,
});

const outputSchema = mediaSummarySchema.extend({
  width: z.number().optional().describe("Original width in pixels"),
  height: z.number().optional().describe("Original height in pixels"),
  hasHashtags: z.boolean().describe("True if the caption contains a # character"),
  hasMentions: z.boolean().describe("True if the caption contains an @ character"),
});

export function registerGetPostDetails(server: McpServer): void {
  server.registerTool(
    "instagram_get_post_details",
    {
      title: "Get post details",
      description:
        "Get full details of one Instagram post by media ID: author, type, full untruncated caption, " +
        "like/comment/view counts, timestamp, location, pixel dimensions, hashtag/mention flags and " +
        "highest-resolution media URLs. Get media IDs from tools such as instagram_get_user_posts or " +
        "instagram_get_timeline_feed. Not paginated.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ mediaId }) => {
      const client = await getLoggedInClient();
      try {
        const { items } = await client.media.info(mediaId);
        const item = items?.[0];
        if (!item) {
          throw new Error(`Media ${mediaId} was not found on Instagram.`);
        }
        const summary = toMediaSummary(item);
        const caption = summary.caption ?? "";
        return structuredResult(
          compact({
            ...summary,
            width: item.original_width,
            height: item.original_height,
            hasHashtags: caption.includes("#"),
            hasMentions: caption.includes("@"),
          })
        );
      } catch (error) {
        throw toToolError(error, `media ${mediaId}`);
      }
    }
  );
}
