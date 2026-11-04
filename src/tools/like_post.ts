/**
 * instagram_like_post: likes a post as the logged-in account.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { mediaIdInput } from "./shared/schemas.js";
import { consumeRateLimit } from "../utils/index.js";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";

export function registerLikePost(server: McpServer): void {
  server.registerTool(
    "instagram_like_post",
    {
      title: "Like a post",
      description:
        "Like an Instagram post as the logged-in account. This is a public action on the user's real account; " +
        "only call it when the user asked for it. Liking an already-liked post has no further effect.",
      inputSchema: z.object({
        mediaId: mediaIdInput,
        module: z
          .enum(["feed_timeline", "feed_contextual_post", "newsfeed", "feed_contextual_newsfeed_multi_media_liked"])
          .default("feed_timeline")
          .describe("Where the like happened in the app, sent to Instagram for analytics (default feed_timeline)"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ mediaId, module }) => {
      const client = await getLoggedInClient();
      consumeRateLimit("like");
      try {
        await client.media.like({ mediaId, moduleInfo: { module_name: module }, d: 1 });
      } catch (error) {
        throw toToolError(error, `media ${mediaId}`);
      }
      return textResult(`Liked post ${mediaId}.`);
    }
  );
}
