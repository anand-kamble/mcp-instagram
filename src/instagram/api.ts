/**
 * Instagram private-API endpoints used by the MCP tools.
 *
 * Every call goes through InstagramClient.request and returns Instagram's raw
 * JSON objects (snake_case), which the tool mappers consume. Paths, query
 * strings and form fields are ported from instagrapi (MIT, see NOTICE).
 */

import { createHmac, randomInt, randomUUID } from "node:crypto";
import type { InstagramClient } from "./client.js";
import { IgNotFoundError } from "./errors.js";

/** Fields the tool mappers read; everything else Instagram sends is kept untyped. */
export interface RawUser {
  pk?: string | number;
  pk_id?: string;
  id?: string | number;
  username?: string;
  full_name?: string;
  is_private?: boolean;
  is_verified?: boolean;
  profile_pic_url?: string;
  hd_profile_pic_url_info?: { url?: string; [key: string]: unknown };
  biography?: string;
  external_url?: string;
  follower_count?: number;
  following_count?: number;
  media_count?: number;
  is_business?: boolean;
  is_business_account?: boolean;
  is_professional_account?: boolean;
  category?: string;
  business_category_name?: string;
  public_email?: string;
  contact_phone_number?: string;
  [key: string]: unknown;
}

export interface RawImageCandidate {
  url?: string;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface RawMedia {
  id?: string;
  pk?: string | number;
  code?: string;
  media_type?: number;
  caption?: string | { text?: string; [key: string]: unknown } | null;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  play_count?: number;
  taken_at?: number;
  user?: RawUser;
  location?: { pk?: string | number; id?: string | number; name?: string; [key: string]: unknown } | null;
  image_versions2?: { candidates?: RawImageCandidate[]; [key: string]: unknown };
  video_versions?: RawImageCandidate[];
  carousel_media?: RawMedia[];
  ad_id?: string | number | null;
  ad_metadata?: unknown;
  [key: string]: unknown;
}

export interface RawComment {
  pk?: string | number;
  id?: string | number;
  text?: string;
  user?: RawUser;
  comment_like_count?: number;
  like_count?: number;
  child_comment_count?: number;
  created_at?: number;
  created_at_utc?: number;
  parent_comment_id?: string | number | null;
  [key: string]: unknown;
}

export interface RawStory {
  id?: string;
  pk?: string | number;
  media_type?: number;
  taken_at?: number;
  expiring_at?: number;
  video_duration?: number;
  viewer_count?: number;
  view_count?: number;
  image_versions2?: { candidates?: RawImageCandidate[]; [key: string]: unknown };
  video_versions?: RawImageCandidate[];
  story_polls?: unknown[];
  story_questions?: unknown[];
  story_sliders?: unknown[];
  story_quizs?: unknown[];
  story_countdowns?: unknown[];
  story_stickers?: unknown[];
  stickers?: unknown[];
  user?: RawUser;
  [key: string]: unknown;
}

export interface RawFriendshipStatus {
  following?: boolean;
  followed_by?: boolean;
  outgoing_request?: boolean;
  incoming_request?: boolean;
  is_private?: boolean;
  [key: string]: unknown;
}

export interface FeedPage<T> {
  items: T[];
  /** Absent when Instagram sent no cursor. */
  nextMaxId?: string;
  moreAvailable: boolean;
}

export interface CommentsPage {
  comments: RawComment[];
  nextMaxId?: string;
  nextMinId?: string;
}

/** instagrapi config.SUPPORTED_CAPABILITIES, sent with story requests. */
const SUPPORTED_CAPABILITIES = [
  {
    value:
      "119.0,120.0,121.0,122.0,123.0,124.0,125.0,126.0,127.0,128.0," +
      "129.0,130.0,131.0,132.0,133.0,134.0,135.0,136.0,137.0,138.0," +
      "139.0,140.0,141.0,142.0",
    name: "SUPPORTED_SDK_VERSIONS",
  },
  { value: "14", name: "FACE_TRACKER_VERSION" },
  { value: "ETC2_COMPRESSION", name: "COMPRESSION" },
  { value: "gyroscope_enabled", name: "gyroscope" },
];

/** "No such interaction yet" signals of a fresh app session (instagrapi _timeline_session_level_signals_json). */
const NEVER_INTERACTED = [
  "ad_click",
  "ad_like",
  "organic_like",
  "like",
  "organic_business_profile_visit",
  "ad_imp",
  "search",
  "organic_engagement_event",
  "ad_profile_visit",
  "ad_cta",
  "ad_caption_more_click",
  "ad_comment_button",
  "ad_share",
  "ad_media_tap",
  "ad_gesture",
  "search_result_click",
  "serp_click",
  "organic_share",
  "organic_comment",
  "organic_caption_click",
  "organic_media_tap",
  "organic_gesture",
];

const TIMELINE_SESSION_LEVEL_SIGNALS = JSON.stringify({
  time_since_current_surface_session_start: 0,
  time_since_fg_session_start: 0,
  time_since_last_background: 0,
  num_ad_seen_current_surface_current_session: 0,
  app_entry: "normal",
  last_surfaces_visited_current_session: [],
  video_play_count: 0,
  video_pause_count: 0,
  video_dwell_time_sum: 0,
  video_dwell_time_max: 0,
  video_view_count: 0,
  video_intentional_audio_on: 0,
  video_intentional_audio_off: 0,
  video_audio_on_count: 0,
  feed_to_reels_iv_entry: 0,
  ...Object.fromEntries(NEVER_INTERACTED.map((name) => [`time_since_last_${name}`, -1])),
  num_search_clicks_current_session: 0,
});

const seg = encodeURIComponent;

/** Pagination cursors may arrive as strings or numbers; empty or missing ones are dropped. */
function cursorOf(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** instagrapi _timezone_name_from_offset: seconds east of UTC -> "GMT-04:00". */
function timezoneName(seconds: number): string {
  if (seconds === 0) return "GMT";
  const abs = Math.abs(seconds);
  const hours = String(Math.floor(abs / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  return `GMT${seconds > 0 ? "+" : "-"}${hours}:${minutes}`;
}

/** Position of the post in the app feed, as the app reports it with likes and comments. */
function feedPosition(): string {
  return String(randomInt(0, 7));
}

/** instagrapi gen_user_breadcrumb: typing telemetry the app attaches to a comment. */
function userBreadcrumb(size: number): string {
  const elapsed = randomInt(500, 1501) + size * randomInt(500, 1501);
  const textChangeEvents = Math.max(1, size / randomInt(3, 6));
  const data = `${size} ${elapsed} ${textChangeEvents} ${Date.now()}`;
  const signature = createHmac("sha256", "iN4$aGr0m").update(data).digest("base64");
  return `${signature}\n${Buffer.from(data, "ascii").toString("base64")}\n`;
}

export class InstagramApi {
  private readonly clientSessionId = randomUUID();
  private readonly requestId = randomUUID();

  constructor(private readonly client: InstagramClient) {}

  /** instagrapi with_action_data: device fields plus radio_type. */
  private actionData(data: Record<string, unknown>): Record<string, unknown> {
    return { ...this.client.deviceFields, radio_type: "wifi-none", ...data };
  }

  /** Ports instagrapi user.py user_info_by_username_v1. */
  async usernameInfo(username: string): Promise<RawUser> {
    const normalized = username.trim().replace(/^@+/, "").trim().toLowerCase();
    const body = await this.client.request<{ user: RawUser }>({
      method: "GET",
      path: `users/${seg(normalized)}/usernameinfo/`,
    });
    return body.user;
  }

  /** Ports instagrapi user.py user_info_v1 (default from_module "self_profile"). */
  async userInfo(userId: string): Promise<RawUser> {
    const body = await this.client.request<{ user: RawUser }>({
      method: "GET",
      path: `users/${seg(userId)}/info/`,
      query: {
        is_prefetch: "false",
        entry_point: "self_profile",
        from_module: "self_profile",
        is_app_start: "false",
      },
    });
    return body.user;
  }

  /** Ports instagrapi account.py account_info. */
  async currentUser(): Promise<RawUser> {
    const body = await this.client.request<{ user: RawUser }>({
      method: "GET",
      path: "accounts/current_user/",
      query: { edit: "true" },
    });
    return body.user;
  }

  /**
   * Ports instagrapi media.py user_medias_paginated_v1. `count` is optional;
   * instagrapi always sends it (default 33), here Instagram picks the page size when it is omitted.
   */
  async userFeed(userId: string, options: { maxId?: string; count?: number } = {}): Promise<FeedPage<RawMedia>> {
    const body = await this.client.request<{
      items?: RawMedia[];
      next_max_id?: string | number;
      more_available?: boolean;
    }>({
      method: "GET",
      path: `feed/user/${seg(userId)}/`,
      query: {
        max_id: options.maxId,
        count: options.count,
        rank_token: `${this.client.userId ?? ""}_${this.client.device.uuid}`,
        ranked_content: "true",
      },
    });
    return this.page(body.items, body);
  }

  /**
   * Ports instagrapi auth.py get_timeline_feed. Posts the form unsigned, as the app does.
   * Omitted: seen_posts / feed_view_info (instagrapi replays media ids from earlier responses;
   * this client is stateless between pages) and the device's real battery/charging state.
   */
  async timeline(options: { maxId?: string } = {}): Promise<FeedPage<RawMedia>> {
    const { maxId } = options;
    const device = this.client.device;
    const now = String(Date.now());
    const form: Record<string, unknown> = {
      app_start_time: now,
      has_camera_permission: "1",
      feed_view_info: "[]",
      client_recorded_request_time_ms: now,
      client_seen_store_media_list: "",
      client_view_state_media_list: "[]",
      device_timezone_name: timezoneName(device.timezoneOffset),
      feed_reshare_info: "",
      phone_id: device.phoneId,
      reason: maxId ? "pagination" : "pull_to_refresh",
      battery_level: "100",
      timezone_offset: String(device.timezoneOffset),
      device_id: device.uuid,
      include_attribution_ui_data: "true",
      push_disabled: "true",
      request_id: this.requestId,
      request_build_time: now,
      _uuid: device.uuid,
      is_charging: String(randomInt(0, 2)),
      is_dark_mode: "1",
      will_sound_on: String(randomInt(0, 2)),
      session_id: this.clientSessionId,
      session_level_signals: TIMELINE_SESSION_LEVEL_SIGNALS,
      bloks_versioning_id: device.bloksVersionId,
      is_pull_to_refresh: maxId ? "0" : "1",
      ...(maxId
        ? {
            max_id: maxId,
            organic_realtime_information: "[]",
            pagination_source: "feed_recs",
            triggered_by_visible_spinner: "false",
          }
        : {}),
    };
    const body = await this.client.request<{
      feed_items?: Array<{ media_or_ad?: RawMedia; media?: RawMedia } | null>;
      next_max_id?: string | number;
      more_available?: boolean;
    }>({
      method: "POST",
      path: "feed/timeline/",
      form,
      signed: false,
      headers: {
        "X-Ads-Opt-Out": "0",
        "X-DEVICE-ID": device.uuid,
        "X-CM-Bandwidth-KBPS": "-1.000",
        "X-CM-Latency": String(randomInt(1, 6)),
      },
    });
    const items = (body.feed_items ?? []).flatMap((entry) => {
      const media = entry?.media_or_ad ?? entry?.media;
      return media ? [media] : [];
    });
    return this.page(items, body);
  }

  /** Ports instagrapi media.py media_info_v1. Throws IgNotFoundError when Instagram returns no item. */
  async mediaInfo(mediaId: string): Promise<RawMedia> {
    const path = `media/${seg(mediaId)}/info/`;
    const body = await this.client.request<{ items?: RawMedia[] }>({ method: "GET", path });
    const item = body.items?.[0];
    if (!item) {
      throw new IgNotFoundError({ status: 404, path, body: body as Record<string, unknown> }, `${path} - media not found`);
    }
    return item;
  }

  /** Ports instagrapi comment.py media_comments_v1_chunk. */
  async mediaComments(mediaId: string, options: { maxId?: string; minId?: string } = {}): Promise<CommentsPage> {
    const body = await this.client.request<{
      comments?: RawComment[];
      next_max_id?: string | number;
      next_min_id?: string | number;
    }>({
      method: "GET",
      path: `media/${seg(mediaId)}/comments/`,
      query: {
        can_support_threading: "true",
        permalink_enabled: "false",
        min_id: options.minId,
        max_id: options.maxId,
      },
    });
    const nextMaxId = cursorOf(body.next_max_id);
    const nextMinId = cursorOf(body.next_min_id);
    return {
      comments: body.comments ?? [],
      ...(nextMaxId ? { nextMaxId } : {}),
      ...(nextMinId ? { nextMinId } : {}),
    };
  }

  /** Ports instagrapi story.py user_stories_v1. Returns [] when the user has no active reel. */
  async userStories(userId: string): Promise<RawStory[]> {
    const body = await this.client.request<{ reel?: { items?: RawStory[] } | null }>({
      method: "GET",
      path: `feed/user/${seg(userId)}/story/`,
      query: { supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES) },
    });
    return body.reel?.items ?? [];
  }

  /**
   * Ports instagrapi user.py search_users_v1. Also sends `q`, the parameter
   * instagram-private-api used, alongside instagrapi's `query`.
   */
  async searchUsers(query: string, count: number): Promise<RawUser[]> {
    const body = await this.client.request<{ users?: RawUser[] }>({
      method: "GET",
      path: "users/search/",
      query: { q: query, query, count },
    });
    return body.users ?? [];
  }

  /**
   * Ports instagrapi media.py media_like, with `container_module` taken from
   * `moduleName` (instagrapi hard-codes "feed_timeline"). instagrapi has no `d`
   * (double-tap) flag, so none is sent.
   */
  async likeMedia(mediaId: string, moduleName: string): Promise<void> {
    await this.client.request({
      method: "POST",
      path: `media/${seg(mediaId)}/like/`,
      form: this.actionData({
        inventory_source: "media_or_ad",
        media_id: mediaId,
        delivery_class: "organic",
        tap_source: "button",
        is_2m_enabled: "false",
        is_from_swipe: "false",
        is_carousel_bumped_post: "false",
        floating_context_items: "[]",
        media_pct_watched: "0",
        container_module: moduleName,
        feed_position: feedPosition(),
      }),
    });
  }

  /** Ports instagrapi comment.py comment_like. */
  async likeComment(commentId: string): Promise<void> {
    await this.client.request({
      method: "POST",
      path: `media/${seg(commentId)}/comment_like/`,
      form: this.actionData({
        is_carousel_bumped_post: "false",
        container_module: "feed_contextual_self_profile",
        feed_position: feedPosition(),
      }),
    });
  }

  /**
   * Ports instagrapi comment.py media_comment. `replied_to_comment_id` is sent
   * as a string (instagrapi sends an int, which loses precision past 2^53 in JS).
   */
  async comment(mediaId: string, text: string, replyToCommentId?: string): Promise<RawComment> {
    const idempotenceToken = randomUUID();
    const body = await this.client.request<{ comment: RawComment }>({
      method: "POST",
      path: `media/${seg(mediaId)}/comment/`,
      form: this.actionData({
        delivery_class: "organic",
        feed_position: feedPosition(),
        container_module: "feed_timeline",
        media_id: mediaId,
        tap_source: "button",
        is_2m_enabled: "false",
        is_carousel_bumped_post: "false",
        is_from_swipe: "false",
        floating_context_items: "[]",
        media_pct_watched: "0",
        user_breadcrumb: userBreadcrumb(text.length),
        idempotence_token: idempotenceToken,
        comment_creation_key: idempotenceToken,
        include_e2ee_mentioned_user_list: "true",
        include_media_code: "true",
        comment_text: text,
        ...(replyToCommentId ? { replied_to_comment_id: replyToCommentId } : {}),
      }),
    });
    return body.comment;
  }

  /** Ports instagrapi user.py user_follow, without its friendship pre-check. */
  async follow(userId: string): Promise<RawFriendshipStatus> {
    const body = await this.client.request<{ friendship_status: RawFriendshipStatus }>({
      method: "POST",
      path: `friendships/create/${seg(userId)}/`,
      form: this.actionData({
        user_id: userId,
        include_follow_friction_check: "1",
        container_module: "profile",
      }),
    });
    return body.friendship_status;
  }

  /** Ports instagrapi auth.py logout (server side only; clearing local session state is the caller's job). */
  async logout(): Promise<void> {
    await this.client.request({
      method: "POST",
      path: "accounts/logout/",
      form: { one_tap_app_login: true },
    });
  }

  private page<T>(
    items: T[] | undefined,
    body: { next_max_id?: string | number; more_available?: boolean }
  ): FeedPage<T> {
    const nextMaxId = cursorOf(body.next_max_id);
    return {
      items: items ?? [],
      ...(nextMaxId ? { nextMaxId } : {}),
      moreAvailable: body.more_available === true,
    };
  }
}
