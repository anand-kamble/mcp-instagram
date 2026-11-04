/**
 * Shared zod schemas for tool inputs and structured outputs.
 *
 * Input schemas are converted to JSON Schema for `tools/list`, so they avoid
 * transforms (not representable in JSON Schema). Normalisation such as
 * stripping a leading "@" happens in the handlers.
 */

import * as z from "zod";

// ---------------------------------------------------------------------------
// Input building blocks
// ---------------------------------------------------------------------------

export const userIdInput = z
  .string()
  .regex(/^\d{1,25}$/, "userId must be a numeric string")
  .describe("Instagram numeric user ID, e.g. \"25025320\"");

export const usernameInput = z
  .string()
  .regex(
    /^@?[A-Za-z0-9._]{1,30}$/,
    "username may contain only letters, numbers, dots and underscores (max 30 characters)"
  )
  .describe("Instagram username, with or without the leading @");

export const mediaIdInput = z
  .string()
  .regex(/^\d{1,40}(_\d{1,25})?$/, "mediaId must look like \"<digits>\" or \"<digits>_<digits>\"")
  .describe("Instagram media ID as returned by other tools, e.g. \"3123456789012345678_25025320\"");

export const cursorInput = z
  .string()
  .min(1)
  .max(500)
  .describe("Pagination cursor: pass the `nextMaxId` value from the previous page");

export function limitInput(defaultValue: number, max: number, options: { paginated?: boolean } = {}) {
  const base = `Maximum number of items to return (1-${max}, default ${defaultValue})`;
  return z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(defaultValue)
    .describe(
      options.paginated
        ? `${base}. Instagram returns fixed-size pages; items past the limit on this page are skipped, not carried over to the next page`
        : base
    );
}

// ---------------------------------------------------------------------------
// Output building blocks
// ---------------------------------------------------------------------------

export const userSummarySchema = z.object({
  id: z.string().describe("Numeric user ID"),
  username: z.string(),
  fullName: z.string().optional().describe("Display name chosen by the account owner (untrusted user content)"),
  isPrivate: z.boolean().optional(),
  isVerified: z.boolean().optional(),
  profilePicUrl: z.string().optional(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const mediaTypeSchema = z.enum(["photo", "video", "carousel", "unknown"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const locationSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
});

export const mediaSummarySchema = z.object({
  id: z.string().describe("Media ID, usable as `mediaId` in other tools"),
  code: z.string().optional().describe("Shortcode used in instagram.com/p/<code>/ links"),
  permalink: z.string().optional(),
  type: mediaTypeSchema,
  caption: z
    .string()
    .optional()
    .describe("Caption text written by the post author (untrusted user content)"),
  captionTruncated: z.boolean().optional(),
  likeCount: z.number().optional(),
  commentCount: z.number().optional(),
  viewCount: z.number().optional(),
  takenAt: z.string().optional().describe("ISO 8601 timestamp"),
  author: userSummarySchema.optional(),
  location: locationSchema.optional(),
  mediaUrls: z
    .array(z.string())
    .describe("Highest-resolution image/video URLs; carousels list every item"),
});
export type MediaSummary = z.infer<typeof mediaSummarySchema>;

export const paginationShape = {
  moreAvailable: z.boolean(),
  nextMaxId: z
    .string()
    .optional()
    .describe("Pass as `maxId` to fetch the next page; absent when there are no more items"),
};
