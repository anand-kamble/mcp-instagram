/**
 * instagram_get_post_comments: a page of comments on a post.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import {
  cursorInput,
  limitInput,
  mediaIdInput,
  paginationShape,
  userSummarySchema,
} from "./shared/schemas.js";
import type { CommentsPage } from "../instagram/api.js";
import { getLoggedInApi, toToolError } from "./shared/instagram.js";
import { compact, isoFromUnixSeconds, toUserSummary } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const inputSchema = z.object({
  mediaId: mediaIdInput,
  maxId: cursorInput.optional(),
  limit: limitInput(12, 50, { paginated: true }),
});

const commentSchema = z.object({
  id: z.string().describe("Comment ID"),
  text: z.string().describe("Comment text written by the commenter (untrusted user content)"),
  author: userSummarySchema.optional(),
  likeCount: z.number().optional(),
  replyCount: z.number().optional().describe("Number of replies to this comment"),
  createdAt: z.string().optional().describe("ISO 8601 timestamp"),
  parentCommentId: z.string().optional().describe("Set when this comment is a reply to another comment"),
});

const outputSchema = z.object({
  mediaId: z.string(),
  comments: z.array(commentSchema),
  ...paginationShape,
});

/**
 * The comments endpoint pages with either `max_id` or `min_id`; more results
 * exist when either cursor is returned. Both are folded into the one opaque `maxId`/`nextMaxId` cursor the
 * tool exposes; a `min:` prefix marks a min_id cursor. A response can carry
 * both, so a continuation keeps the direction of the cursor it was given; the
 * first page prefers max_id.
 */
const MIN_CURSOR_PREFIX = "min:";

/** Splits the tool's opaque cursor into the max_id / min_id Instagram expects. */
function parseCommentsCursor(cursor: string | undefined): { maxId?: string; minId?: string } {
  if (!cursor) return {};
  return cursor.startsWith(MIN_CURSOR_PREFIX)
    ? { minId: cursor.slice(MIN_CURSOR_PREFIX.length) }
    : { maxId: cursor };
}

function nextCommentsCursor(
  page: CommentsPage,
  previousCursor: string | undefined
): { moreAvailable: boolean; nextMaxId?: string } {
  const max = page.nextMaxId;
  const min = page.nextMinId ? `${MIN_CURSOR_PREFIX}${page.nextMinId}` : undefined;
  const cursor = previousCursor?.startsWith(MIN_CURSOR_PREFIX) ? (min ?? max) : (max ?? min);
  return cursor ? { moreAvailable: true, nextMaxId: cursor } : { moreAvailable: false };
}

function toComment(comment: Raw): z.infer<typeof commentSchema> {
  return compact({
    id: String(comment.pk ?? comment.id ?? ""),
    text: typeof comment.text === "string" ? comment.text : "",
    author: comment.user ? toUserSummary(comment.user) : undefined,
    likeCount: comment.comment_like_count ?? comment.like_count,
    replyCount: comment.child_comment_count,
    createdAt: isoFromUnixSeconds(comment.created_at ?? comment.created_at_utc),
    parentCommentId: comment.parent_comment_id ? String(comment.parent_comment_id) : undefined,
  });
}

export function registerGetPostComments(server: McpServer): void {
  server.registerTool(
    "instagram_get_post_comments",
    {
      title: "Get post comments",
      description:
        "Get one page of comments on an Instagram post: comment ID, text, author, like and reply counts and " +
        "timestamp. Instagram chooses the page size; `limit` caps how many are returned. " +
        "To get the next page, call again with maxId set to the returned nextMaxId.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ mediaId, maxId, limit }) => {
      const api = await getLoggedInApi();
      try {
        const page = await api.mediaComments(mediaId, parseCommentsCursor(maxId));
        const comments = page.comments.slice(0, limit).map(toComment);
        return structuredResult({
          mediaId,
          comments,
          ...nextCommentsCursor(page, maxId),
        });
      } catch (error) {
        throw toToolError(error, `media ${mediaId}`);
      }
    }
  );
}
