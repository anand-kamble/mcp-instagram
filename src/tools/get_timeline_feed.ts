/**
 * instagram_get_timeline_feed: a page of the logged-in account's home feed.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { cursorInput, limitInput, mediaSummarySchema, paginationShape } from "./shared/schemas.js";
import { getFeedCursor, getLoggedInClient, setFeedCursor, toToolError } from "./shared/instagram.js";
import { toMediaSummary } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

const inputSchema = z.object({
  maxId: cursorInput.optional(),
  limit: limitInput(12, 50, { paginated: true }),
});

const timelinePostSchema = mediaSummarySchema.extend({
  sponsored: z.boolean().optional().describe("True for ads Instagram inserts into the feed"),
});

const outputSchema = z.object({
  posts: z.array(timelinePostSchema),
  ...paginationShape,
});

export function registerGetTimelineFeed(server: McpServer): void {
  server.registerTool(
    "instagram_get_timeline_feed",
    {
      title: "Get home timeline",
      description:
        "Get one page of the logged-in account's home timeline (posts from followed accounts, plus ads, which are " +
        "marked sponsored): media IDs, type, caption (truncated to 300 characters), like/comment counts, " +
        "timestamp, author and media URLs. Instagram chooses the page size; `limit` caps how many are " +
        "returned. To get the next page, call again with maxId set to the returned nextMaxId.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ maxId, limit }) => {
      const client = await getLoggedInClient();
      try {
        const feed = client.feed.timeline();
        setFeedCursor(feed, maxId);
        const items = await feed.items();
        const posts = items.slice(0, limit).map((item) => {
          const post = toMediaSummary(item, { maxCaptionLength: 300 });
          return item.ad_id || item.ad_metadata ? { ...post, sponsored: true } : post;
        });
        return structuredResult({
          posts,
          ...getFeedCursor(feed),
        });
      } catch (error) {
        throw toToolError(error, "the home timeline");
      }
    }
  );
}
