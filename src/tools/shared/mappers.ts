/**
 * Mapping from raw Instagram API response objects (src/instagram/api.ts) to the structured
 * output shapes in ./schemas.ts.
 *
 * Inputs are typed loosely on purpose: the library's response typings do not
 * cover every field Instagram returns, and fields vary by endpoint.
 */

import type { MediaSummary, MediaType, UserSummary } from "./schemas.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

/** Converts a Unix timestamp in seconds to ISO 8601. */
export function isoFromUnixSeconds(value: unknown): string | undefined {
  const seconds = typeof value === "string" ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return undefined;
  }
  return new Date(seconds * 1000).toISOString();
}

export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, max)}…`, truncated: true };
}

/** Assigns only defined values, so optional schema fields stay absent rather than `undefined`. */
export function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined || value[key] === null) {
      delete value[key];
    }
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return String(value);
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function toUserSummary(user: Raw): UserSummary {
  return compact({
    id: String(user.pk ?? user.pk_id ?? user.id ?? ""),
    username: String(user.username ?? ""),
    fullName: optionalString(user.full_name),
    isPrivate: optionalBoolean(user.is_private),
    isVerified: optionalBoolean(user.is_verified),
    profilePicUrl: optionalString(user.profile_pic_url),
  });
}

export function mediaTypeOf(item: Raw): MediaType {
  switch (item.media_type) {
    case 1:
      return "photo";
    case 2:
      return "video";
    case 8:
      return "carousel";
    default:
      return item.carousel_media ? "carousel" : "unknown";
  }
}

/** Picks the URL with the largest pixel area from a candidates/versions list. */
export function largestUrl(candidates: unknown): string | undefined {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return undefined;
  }
  let best: Raw | undefined;
  let bestArea = -1;
  for (const candidate of candidates as Raw[]) {
    if (!candidate?.url) continue;
    const area = (Number(candidate.width) || 0) * (Number(candidate.height) || 0);
    if (area > bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return best?.url ? String(best.url) : undefined;
}

/**
 * Returns the best URL for each visual item: the video for videos (plus the
 * cover image), the largest image for photos, and one entry per carousel item.
 */
export function mediaUrlsOf(item: Raw): string[] {
  const urls: string[] = [];
  const push = (url: string | undefined) => {
    if (url && !urls.includes(url)) urls.push(url);
  };

  if (Array.isArray(item.carousel_media) && item.carousel_media.length > 0) {
    for (const child of item.carousel_media as Raw[]) {
      push(largestUrl(child.video_versions) ?? largestUrl(child.image_versions2?.candidates));
    }
    return urls;
  }

  push(largestUrl(item.video_versions));
  push(largestUrl(item.image_versions2?.candidates));
  return urls;
}

export interface MediaSummaryOptions {
  /** Truncate captions longer than this many characters (list views). */
  maxCaptionLength?: number;
}

export function toMediaSummary(item: Raw, options: MediaSummaryOptions = {}): MediaSummary {
  const rawCaption: string | undefined =
    typeof item.caption === "string" ? item.caption : optionalString(item.caption?.text);
  let caption = rawCaption;
  let captionTruncated: boolean | undefined;
  if (rawCaption !== undefined && options.maxCaptionLength !== undefined) {
    const result = truncate(rawCaption, options.maxCaptionLength);
    caption = result.text;
    captionTruncated = result.truncated || undefined;
  }

  const code = optionalString(item.code);
  return compact({
    id: String(item.id ?? item.pk ?? ""),
    code,
    permalink: code ? `https://www.instagram.com/p/${code}/` : undefined,
    type: mediaTypeOf(item),
    caption,
    captionTruncated,
    likeCount: optionalNumber(item.like_count),
    commentCount: optionalNumber(item.comment_count),
    viewCount: optionalNumber(item.view_count ?? item.play_count),
    takenAt: isoFromUnixSeconds(item.taken_at),
    author: item.user ? toUserSummary(item.user) : undefined,
    location: item.location?.name
      ? compact({ id: optionalString(item.location.pk ?? item.location.id), name: String(item.location.name) })
      : undefined,
    mediaUrls: mediaUrlsOf(item),
  });
}
