/**
 * instagram_get_user_stories: a user's currently active stories.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { userIdInput, usernameInput } from "./shared/schemas.js";
import { getLoggedInApi, normalizeUsername, resolveUserId, toToolError } from "./shared/instagram.js";
import { compact, isoFromUnixSeconds, mediaUrlsOf } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const SECONDS_PER_DAY = 86_400;

const inputSchema = z
  .object({
    userId: userIdInput.optional(),
    username: usernameInput.optional(),
  })
  .refine((args) => Boolean(args.userId) !== Boolean(args.username), {
    message: "Provide exactly one of userId or username.",
  });

const stickerTypeSchema = z.enum(["poll", "question", "slider", "quiz", "countdown"]);

const storySchema = z.object({
  id: z.string().describe("Story media ID"),
  type: z.enum(["photo", "video", "reel", "unknown"]),
  mediaUrls: z.array(z.string()).describe("Highest-resolution video URL (if any) and image URL"),
  takenAt: z.string().optional().describe("ISO 8601 timestamp"),
  expiresAt: z.string().optional().describe("ISO 8601 timestamp when the story disappears"),
  videoDurationSeconds: z.number().optional(),
  viewerCount: z.number().optional().describe("Only available for the logged-in account's own stories"),
  stickerTypes: z.array(stickerTypeSchema).optional().describe("Interactive stickers on the story"),
});

const outputSchema = z.object({
  userId: z.string(),
  username: z.string().optional(),
  stories: z.array(storySchema),
});

/** Sticker arrays on a reel item, keyed by the sticker type they represent. */
const STICKER_FIELDS = {
  story_polls: "poll",
  story_questions: "question",
  story_sliders: "slider",
  story_quizs: "quiz",
  story_countdowns: "countdown",
} as const;

/** Legacy per-sticker keys inside a `story_stickers`/`stickers` array. */
const STICKER_ENTRY_KEYS = {
  poll_sticker: "poll",
  question_sticker: "question",
  slider_sticker: "slider",
  quiz_sticker: "quiz",
  countdown_sticker: "countdown",
} as const;

function stickerTypesOf(story: Raw): Array<z.infer<typeof stickerTypeSchema>> {
  const found = new Set<z.infer<typeof stickerTypeSchema>>();
  for (const [field, type] of Object.entries(STICKER_FIELDS)) {
    if (Array.isArray(story[field]) && story[field].length > 0) found.add(type);
  }
  const entries: Raw[] = story.story_stickers ?? story.stickers ?? [];
  for (const entry of entries) {
    for (const [key, type] of Object.entries(STICKER_ENTRY_KEYS)) {
      if (entry?.[key]) found.add(type);
    }
  }
  return [...found];
}

function storyTypeOf(story: Raw): z.infer<typeof storySchema>["type"] {
  switch (story.media_type) {
    case 1:
      return "photo";
    case 2:
      return "video";
    case 3:
      return "reel";
    default:
      return "unknown";
  }
}

function toStory(story: Raw): z.infer<typeof storySchema> {
  const takenAt = typeof story.taken_at === "number" ? story.taken_at : undefined;
  const viewerCount = story.viewer_count ?? story.view_count;
  const stickerTypes = stickerTypesOf(story);
  return compact({
    id: String(story.id ?? story.pk ?? ""),
    type: storyTypeOf(story),
    mediaUrls: mediaUrlsOf(story),
    takenAt: isoFromUnixSeconds(takenAt),
    expiresAt: isoFromUnixSeconds(story.expiring_at ?? (takenAt ? takenAt + SECONDS_PER_DAY : undefined)),
    videoDurationSeconds: typeof story.video_duration === "number" ? story.video_duration : undefined,
    viewerCount: typeof viewerCount === "number" ? viewerCount : undefined,
    stickerTypes: stickerTypes.length > 0 ? stickerTypes : undefined,
  });
}

export function registerGetUserStories(server: McpServer): void {
  server.registerTool(
    "instagram_get_user_stories",
    {
      title: "Get user stories",
      description:
        "Get a user's currently active Instagram stories: story IDs, type (photo/video), media URLs, " +
        "posted and expiry times, video duration, interactive sticker types, and viewer count (own " +
        "stories only). Provide exactly one of userId or username. Stories expire after 24 hours, so an " +
        "empty list means none are active. Not paginated.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ userId, username }) => {
      const api = await getLoggedInApi();
      const subject = username ? `user "${normalizeUsername(username)}"` : `user ID ${userId}`;
      try {
        const targetUserId = await resolveUserId(api, { userId, username });
        const items = await api.userStories(targetUserId);
        const resolvedUsername =
          (username ? normalizeUsername(username) : undefined) ?? items[0]?.user?.username;
        return structuredResult({
          userId: targetUserId,
          ...(resolvedUsername ? { username: resolvedUsername } : {}),
          stories: items.map(toStory),
        });
      } catch (error) {
        throw toToolError(error, subject);
      }
    }
  );
}
