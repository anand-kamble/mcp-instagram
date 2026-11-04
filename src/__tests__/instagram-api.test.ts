/**
 * Unit tests for InstagramApi: each endpoint's path, method, query/form
 * fields and response extraction, against a fake fetch (no network).
 */

import { describe, expect, it } from "@jest/globals";
import { InstagramApi } from "../instagram/api.js";
import { InstagramClient } from "../instagram/client.js";
import { createDeviceProfile } from "../instagram/device.js";
import { IgNotFoundError } from "../instagram/errors.js";
import type { SessionState } from "../instagram/types.js";

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const USER_ID = "1234";

/** An API wired to a fake fetch that records every request and answers with `responseBody`. */
function setup(responseBody: Record<string, unknown> = { status: "ok" }) {
  const calls: Call[] = [];
  const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body === undefined ? undefined : String(init.body),
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const session: SessionState = {
    version: 2,
    device: createDeviceProfile({ timezoneOffset: -14400 }),
    cookies: {},
    authorization: { ds_user_id: USER_ID, sessionid: "session-id" },
  };
  const client = new InstagramClient({ fetch: fakeFetch, session });
  const api = new InstagramApi(client);
  return { api, client, calls, call: () => calls[0] };
}

const query = (call: Call) => Object.fromEntries(call.url.searchParams);

/** Decodes `signed_body=SIGNATURE.<json>` and checks it is the only body field. */
function signedForm(call: Call): Record<string, unknown> {
  const params = new URLSearchParams(call.body);
  expect([...params.keys()]).toEqual(["signed_body"]);
  const signed = params.get("signed_body") as string;
  expect(signed.startsWith("SIGNATURE.")).toBe(true);
  return JSON.parse(signed.slice("SIGNATURE.".length)) as Record<string, unknown>;
}

const plainForm = (call: Call) => Object.fromEntries(new URLSearchParams(call.body));

describe("read endpoints", () => {
  it("usernameInfo: GET users/{username}/usernameinfo/ with a normalized username", async () => {
    const { api, call } = setup({ status: "ok", user: { pk: 25025320, username: "nasa" } });
    const user = await api.usernameInfo("  @NASA ");
    expect(call().method).toBe("GET");
    expect(call().url.host).toBe("i.instagram.com");
    expect(call().url.pathname).toBe("/api/v1/users/nasa/usernameinfo/");
    expect(call().body).toBeUndefined();
    expect(call().headers.Authorization).toMatch(/^Bearer IGT:2:/);
    expect(user).toEqual({ pk: 25025320, username: "nasa" });
  });

  it("userInfo: GET users/{id}/info/ with instagrapi's profile params", async () => {
    const { api, call } = setup({ status: "ok", user: { pk: "25025320", follower_count: 10 } });
    const user = await api.userInfo("25025320");
    expect(call().method).toBe("GET");
    expect(call().url.pathname).toBe("/api/v1/users/25025320/info/");
    expect(query(call())).toEqual({
      is_prefetch: "false",
      entry_point: "self_profile",
      from_module: "self_profile",
      is_app_start: "false",
    });
    expect(user).toEqual({ pk: "25025320", follower_count: 10 });
  });

  it("currentUser: GET accounts/current_user/?edit=true", async () => {
    const { api, call } = setup({ status: "ok", user: { pk: "1234", username: "me" } });
    const user = await api.currentUser();
    expect(call().method).toBe("GET");
    expect(call().url.pathname).toBe("/api/v1/accounts/current_user/");
    expect(query(call())).toEqual({ edit: "true" });
    expect(user).toEqual({ pk: "1234", username: "me" });
  });

  describe("userFeed", () => {
    it("requests the first page without max_id and extracts items and cursor", async () => {
      const { api, client, call } = setup({
        status: "ok",
        items: [{ id: "1_2" }, { id: "3_2" }],
        next_max_id: "cursor-1",
        more_available: true,
      });
      const page = await api.userFeed("2");
      expect(call().method).toBe("GET");
      expect(call().url.pathname).toBe("/api/v1/feed/user/2/");
      expect(query(call())).toEqual({
        rank_token: `${USER_ID}_${client.device.uuid}`,
        ranked_content: "true",
      });
      expect(page).toEqual({ items: [{ id: "1_2" }, { id: "3_2" }], nextMaxId: "cursor-1", moreAvailable: true });
    });

    it("sends max_id and count on later pages and coerces a numeric cursor", async () => {
      const { api, call } = setup({ status: "ok", items: [], next_max_id: 17850000000, more_available: true });
      const page = await api.userFeed("2", { maxId: "cursor-1", count: 12 });
      expect(query(call())).toMatchObject({ max_id: "cursor-1", count: "12" });
      expect(page.nextMaxId).toBe("17850000000");
    });

    it("omits the cursor on the last page", async () => {
      const { api } = setup({ status: "ok", items: [{ id: "1_2" }], more_available: false });
      const page = await api.userFeed("2");
      expect(page).toEqual({ items: [{ id: "1_2" }], moreAvailable: false });
      expect("nextMaxId" in page).toBe(false);
    });

    it("treats an empty cursor and a missing items list as absent", async () => {
      const { api } = setup({ status: "ok", next_max_id: "" });
      expect(await api.userFeed("2")).toEqual({ items: [], moreAvailable: false });
    });
  });

  describe("timeline", () => {
    const feedItems = [
      { media_or_ad: { id: "10_1" } },
      { end_of_feed_demarcator: {} },
      null,
      { media: { id: "11_1" } },
      { media_or_ad: { id: "12_1", ad_id: "99" } },
    ];

    it("posts an unsigned form for the first page as pull_to_refresh", async () => {
      const { api, client, call } = setup({
        status: "ok",
        feed_items: feedItems,
        next_max_id: "tl-1",
        more_available: true,
      });
      const page = await api.timeline();
      const device = client.device;

      expect(call().method).toBe("POST");
      expect(call().url.pathname).toBe("/api/v1/feed/timeline/");
      expect(call().headers["Content-Type"]).toBe("application/x-www-form-urlencoded; charset=UTF-8");
      expect(call().headers["X-Ads-Opt-Out"]).toBe("0");
      expect(call().headers["X-DEVICE-ID"]).toBe(device.uuid);
      expect(call().headers["X-CM-Bandwidth-KBPS"]).toBe("-1.000");
      expect(call().headers["X-CM-Latency"]).toMatch(/^[1-5]$/);

      const form = plainForm(call());
      expect(form.signed_body).toBeUndefined();
      expect(form).toMatchObject({
        reason: "pull_to_refresh",
        is_pull_to_refresh: "1",
        phone_id: device.phoneId,
        device_id: device.uuid,
        _uuid: device.uuid,
        timezone_offset: "-14400",
        device_timezone_name: "GMT-04:00",
        bloks_versioning_id: device.bloksVersionId,
        feed_view_info: "[]",
      });
      expect(form.max_id).toBeUndefined();
      expect(form.pagination_source).toBeUndefined();
      expect(form.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(form.session_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(form.is_charging).toMatch(/^[01]$/);
      const signals = JSON.parse(form.session_level_signals) as Record<string, unknown>;
      expect(signals).toMatchObject({ app_entry: "normal", time_since_last_like: -1, num_search_clicks_current_session: 0 });

      expect(page).toEqual({
        items: [{ id: "10_1" }, { id: "11_1" }, { id: "12_1", ad_id: "99" }],
        nextMaxId: "tl-1",
        moreAvailable: true,
      });
    });

    it("paginates with max_id and reason=pagination", async () => {
      const { api, call } = setup({ status: "ok", feed_items: [], next_max_id: 555, more_available: true });
      const page = await api.timeline({ maxId: "tl-1" });
      expect(plainForm(call())).toMatchObject({
        reason: "pagination",
        is_pull_to_refresh: "0",
        max_id: "tl-1",
        pagination_source: "feed_recs",
        triggered_by_visible_spinner: "false",
        organic_realtime_information: "[]",
      });
      expect(page).toEqual({ items: [], nextMaxId: "555", moreAvailable: true });
    });

    it("reuses the same session and request ids across pages", async () => {
      const { api, calls } = setup({ status: "ok", feed_items: [] });
      await api.timeline();
      await api.timeline({ maxId: "x" });
      const [first, second] = calls.map(plainForm);
      expect(second.session_id).toBe(first.session_id);
      expect(second.request_id).toBe(first.request_id);
    });

    it("omits the cursor when Instagram sends none", async () => {
      const { api } = setup({ status: "ok", more_available: false });
      const page = await api.timeline();
      expect(page).toEqual({ items: [], moreAvailable: false });
      expect("nextMaxId" in page).toBe(false);
    });
  });

  describe("mediaInfo", () => {
    it("returns the first item of media/{id}/info/", async () => {
      const { api, call } = setup({ status: "ok", items: [{ id: "123_456", code: "ABC" }, { id: "other" }] });
      const media = await api.mediaInfo("123_456");
      expect(call().method).toBe("GET");
      expect(call().url.pathname).toBe("/api/v1/media/123_456/info/");
      expect(media).toEqual({ id: "123_456", code: "ABC" });
    });

    it("throws IgNotFoundError when items is empty", async () => {
      const { api } = setup({ status: "ok", items: [] });
      await expect(api.mediaInfo("123_456")).rejects.toBeInstanceOf(IgNotFoundError);
    });

    it("throws IgNotFoundError when items is missing", async () => {
      const { api } = setup({ status: "ok" });
      await expect(api.mediaInfo("123")).rejects.toBeInstanceOf(IgNotFoundError);
    });
  });

  describe("mediaComments", () => {
    it("requests the first page with instagrapi's params and extracts both cursors", async () => {
      const { api, call } = setup({
        status: "ok",
        comments: [{ pk: "1", text: "hi" }],
        next_max_id: "max-1",
        next_min_id: 42,
      });
      const page = await api.mediaComments("123_456");
      expect(call().method).toBe("GET");
      expect(call().url.pathname).toBe("/api/v1/media/123_456/comments/");
      expect(query(call())).toEqual({ can_support_threading: "true", permalink_enabled: "false" });
      expect(page).toEqual({ comments: [{ pk: "1", text: "hi" }], nextMaxId: "max-1", nextMinId: "42" });
    });

    it("passes max_id and min_id when given", async () => {
      const { api, call } = setup({ status: "ok", comments: [] });
      await api.mediaComments("123", { maxId: "m", minId: "n" });
      expect(query(call())).toMatchObject({ max_id: "m", min_id: "n" });
    });

    it("omits absent cursors", async () => {
      const { api } = setup({ status: "ok", comments: [{ pk: "1" }], next_min_id: "only-min" });
      const page = await api.mediaComments("123");
      expect(page).toEqual({ comments: [{ pk: "1" }], nextMinId: "only-min" });
      expect("nextMaxId" in page).toBe(false);

      const last = await setup({ status: "ok" }).api.mediaComments("123");
      expect(last).toEqual({ comments: [] });
    });
  });

  describe("userStories", () => {
    it("returns reel.items and sends supported_capabilities_new", async () => {
      const { api, call } = setup({ status: "ok", reel: { items: [{ id: "s1" }, { id: "s2" }] } });
      const stories = await api.userStories("25025320");
      expect(call().method).toBe("GET");
      expect(call().url.pathname).toBe("/api/v1/feed/user/25025320/story/");
      const capabilities = JSON.parse(query(call()).supported_capabilities_new) as Array<{ name: string }>;
      expect(capabilities.map((c) => c.name)).toEqual([
        "SUPPORTED_SDK_VERSIONS",
        "FACE_TRACKER_VERSION",
        "COMPRESSION",
        "gyroscope",
      ]);
      expect(stories).toEqual([{ id: "s1" }, { id: "s2" }]);
    });

    it("returns [] when there is no reel", async () => {
      expect(await setup({ status: "ok" }).api.userStories("1")).toEqual([]);
      expect(await setup({ status: "ok", reel: null }).api.userStories("1")).toEqual([]);
      expect(await setup({ status: "ok", reel: {} }).api.userStories("1")).toEqual([]);
    });
  });

  describe("searchUsers", () => {
    it("GETs users/search/ and returns the raw users", async () => {
      const { api, call } = setup({ status: "ok", users: [{ pk: "1", username: "nasa" }] });
      const users = await api.searchUsers("nasa", 30);
      expect(call().method).toBe("GET");
      expect(call().url.pathname).toBe("/api/v1/users/search/");
      expect(query(call())).toEqual({ q: "nasa", query: "nasa", count: "30" });
      expect(users).toEqual([{ pk: "1", username: "nasa" }]);
    });

    it("returns [] when users is missing", async () => {
      expect(await setup({ status: "ok" }).api.searchUsers("zzz", 5)).toEqual([]);
    });
  });
});

describe("write endpoints", () => {
  it("likeMedia: signed POST media/{id}/like/ with the action fields", async () => {
    const { api, client, call } = setup();
    await expect(api.likeMedia("123_456", "feed_contextual_post")).resolves.toBeUndefined();
    expect(call().method).toBe("POST");
    expect(call().url.pathname).toBe("/api/v1/media/123_456/like/");
    expect(call().headers["Content-Type"]).toBe("application/x-www-form-urlencoded; charset=UTF-8");
    const form = signedForm(call());
    expect(form).toMatchObject({
      media_id: "123_456",
      container_module: "feed_contextual_post",
      inventory_source: "media_or_ad",
      radio_type: "wifi-none",
      delivery_class: "organic",
      _uuid: client.device.uuid,
      device_id: client.device.androidId,
      _uid: USER_ID,
    });
    expect(form.feed_position).toMatch(/^[0-6]$/);
  });

  it("likeComment: signed POST media/{commentId}/comment_like/", async () => {
    const { api, client, call } = setup();
    await expect(api.likeComment("17900000000000001")).resolves.toBeUndefined();
    expect(call().method).toBe("POST");
    expect(call().url.pathname).toBe("/api/v1/media/17900000000000001/comment_like/");
    expect(signedForm(call())).toMatchObject({
      _uuid: client.device.uuid,
      device_id: client.device.androidId,
      _uid: USER_ID,
      radio_type: "wifi-none",
      container_module: "feed_contextual_self_profile",
    });
  });

  describe("comment", () => {
    it("posts a top-level comment and returns the raw comment", async () => {
      const { api, client, call } = setup({ status: "ok", comment: { pk: "18000000000000002", text: "nice" } });
      const comment = await api.comment("123_456", "nice");
      expect(call().method).toBe("POST");
      expect(call().url.pathname).toBe("/api/v1/media/123_456/comment/");
      const form = signedForm(call());
      expect(form).toMatchObject({
        media_id: "123_456",
        comment_text: "nice",
        container_module: "feed_timeline",
        include_media_code: "true",
        _uuid: client.device.uuid,
        device_id: client.device.androidId,
        _uid: USER_ID,
        radio_type: "wifi-none",
      });
      expect("replied_to_comment_id" in form).toBe(false);
      expect(form.idempotence_token).toMatch(/^[0-9a-f-]{36}$/);
      expect(form.comment_creation_key).toBe(form.idempotence_token);
      const [signature, data, trailing] = (form.user_breadcrumb as string).split("\n");
      expect(signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(Buffer.from(data, "base64").toString("ascii")).toMatch(/^4 \d+ [\d.]+ \d+$/);
      expect(trailing).toBe("");
      expect(comment).toEqual({ pk: "18000000000000002", text: "nice" });
    });

    it("sends replied_to_comment_id as a string without losing digits", async () => {
      const { api, call } = setup({ status: "ok", comment: { pk: "1" } });
      await api.comment("123_456", "reply", "17900000000000001");
      expect(signedForm(call()).replied_to_comment_id).toBe("17900000000000001");
    });
  });

  it("follow: signed POST friendships/create/{id}/ returns friendship_status", async () => {
    const { api, client, call } = setup({
      status: "ok",
      friendship_status: { following: false, outgoing_request: true, is_private: true },
    });
    const status = await api.follow("99");
    expect(call().method).toBe("POST");
    expect(call().url.pathname).toBe("/api/v1/friendships/create/99/");
    expect(signedForm(call())).toMatchObject({
      user_id: "99",
      include_follow_friction_check: "1",
      container_module: "profile",
      radio_type: "wifi-none",
      _uuid: client.device.uuid,
      device_id: client.device.androidId,
      _uid: USER_ID,
    });
    expect(status).toEqual({ following: false, outgoing_request: true, is_private: true });
  });

  it("logout: signed POST accounts/logout/ with one_tap_app_login", async () => {
    const { api, call } = setup();
    await expect(api.logout()).resolves.toBeUndefined();
    expect(call().method).toBe("POST");
    expect(call().url.pathname).toBe("/api/v1/accounts/logout/");
    expect(signedForm(call())).toEqual({ one_tap_app_login: true });
  });
});
