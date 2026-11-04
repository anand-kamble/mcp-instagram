/**
 * instagram_get_user_posts: a page of a user's posts.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  cursorInput,
  limitInput,
  mediaSummarySchema,
  paginationShape,
  userIdInput,
  usernameInput,
} from "./shared/schemas.js";
import { getLoggedInApi, normalizeUsername, resolveUserId, toToolError } from "./shared/instagram.js";
import { toMediaSummary } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

const inputSchema = z
  .object({
    userId: userIdInput.optional(),
    username: usernameInput.optional(),
    maxId: cursorInput.optional(),
    limit: limitInput(12, 50, { paginated: true }),
  })
  .refine((args) => Boolean(args.userId) !== Boolean(args.username), {
    message: "Provide exactly one of userId or username.",
  });

const outputSchema = z.object({
  userId: z.string(),
  username: z.string().optional(),
  posts: z.array(mediaSummarySchema),
  ...paginationShape,
});

export function registerGetUserPosts(server: McpServer): void {
  server.registerTool(
    "instagram_get_user_posts",
    {
      title: "Get user posts",
      description:
        "Get one page of a user's Instagram posts: media IDs, type, caption (truncated to 300 characters), " +
        "like/comment counts, timestamp and media URLs. Provide exactly one of userId or username. " +
        "Instagram returns roughly 12-18 posts per page; `limit` caps how many are returned. " +
        "To get the next page, call again with maxId set to the returned nextMaxId.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ userId, username, maxId, limit }) => {
      const api = await getLoggedInApi();
      const subject = username ? `user "${normalizeUsername(username)}"` : `user ID ${userId}`;
      try {
        const targetUserId = await resolveUserId(api, { userId, username });
        const page = await api.userFeed(targetUserId, { maxId });
        const posts = page.items.slice(0, limit).map((item) => toMediaSummary(item, { maxCaptionLength: 300 }));
        const resolvedUsername =
          (username ? normalizeUsername(username) : undefined) ?? posts[0]?.author?.username;
        return structuredResult({
          userId: targetUserId,
          ...(resolvedUsername ? { username: resolvedUsername } : {}),
          posts,
          moreAvailable: page.moreAvailable,
          ...(page.nextMaxId ? { nextMaxId: page.nextMaxId } : {}),
        });
      } catch (error) {
        throw toToolError(error, subject);
      }
    }
  );
}
