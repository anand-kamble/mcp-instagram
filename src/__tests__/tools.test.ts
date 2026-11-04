/**
 * Behaviour of the Instagram tools against a fake IgApiClient.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { IgActionSpamError, IgLoginRequiredError, IgNotFoundError, IgResponseError } from "instagram-private-api";
import { resetRateLimiter } from "../utils/rateLimit.js";
import { call, connect, fakeFeed, fakeResponse, stubInstagram, textOf } from "./helpers.js";
import type { Connection } from "./helpers.js";

let connection: Connection;

beforeAll(async () => {
  connection = await connect("modern");
});

afterAll(async () => {
  await connection.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function post(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code: `code${id}`,
    media_type: 1,
    caption: { text: `caption ${id}` },
    like_count: 10,
    comment_count: 2,
    taken_at: 1_700_000_000,
    user: { pk: 7, username: "nasa", full_name: "NASA", is_verified: true },
    image_versions2: {
      candidates: [
        { url: `https://cdn.example/${id}-small.jpg`, width: 320, height: 320 },
        { url: `https://cdn.example/${id}-large.jpg`, width: 1080, height: 1080 },
      ],
    },
    ...overrides,
  };
}

describe("input validation", () => {
  it.each([
    ["instagram_like_post", {}],
    ["instagram_like_post", { mediaId: "not-an-id" }],
    ["instagram_comment_on_post", { mediaId: "1_2", text: "" }],
    ["instagram_comment_on_post", { mediaId: "1_2", text: "   " }],
    ["instagram_comment_on_post", { mediaId: "1_2", text: "x".repeat(2201) }],
    ["instagram_follow_user", { userId: "abc" }],
    ["instagram_like_comment", { commentId: "" }],
    ["instagram_get_user_posts", {}],
    ["instagram_get_user_posts", { userId: "1", username: "nasa" }],
    ["instagram_get_user_posts", { username: "bad name!" }],
    ["instagram_get_user_posts", { username: "nasa", limit: 0 }],
    ["instagram_get_user_posts", { username: "nasa", limit: 51 }],
  ])("%s rejects %j as a tool error", async (name, args) => {
    stubInstagram();
    const result = await call(connection, name, args);
    expect(result.isError).toBe(true);
  });
});

describe("authentication", () => {
  it.each([
    ["instagram_get_user_posts", { username: "nasa" }],
    ["instagram_like_post", { mediaId: "1_2" }],
    ["instagram_follow_user", { userId: "7" }],
  ])("%s requires a session", async (name, args) => {
    stubInstagram({}, { loggedIn: false });
    const result = await call(connection, name, args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("instagram_login");
  });
});

describe("instagram_get_user_posts", () => {
  it("returns structured posts with the largest image and a usable cursor", async () => {
    const feed = fakeFeed([{ items: [post("1_7"), post("2_7")], nextMaxId: "cursor-2" }]);
    stubInstagram({
      user: { usernameinfo: jest.fn(async () => ({ pk: 7 })) },
      feed: { user: jest.fn(() => feed) },
    });

    const result = await call(connection, "instagram_get_user_posts", { username: "@nasa", limit: 1 });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as Record<string, any>;
    expect(data.userId).toBe("7");
    expect(data.username).toBe("nasa");
    expect(data.posts).toHaveLength(1);
    expect(data.posts[0]).toMatchObject({
      id: "1_7",
      type: "photo",
      caption: "caption 1_7",
      likeCount: 10,
      commentCount: 2,
      takenAt: "2023-11-14T22:13:20.000Z",
      permalink: "https://www.instagram.com/p/code1_7/",
      mediaUrls: ["https://cdn.example/1_7-large.jpg"],
      author: { id: "7", username: "nasa" },
    });
    expect(data.moreAvailable).toBe(true);
    expect(data.nextMaxId).toBe("cursor-2");
    expect(JSON.parse(textOf(result))).toEqual(data);
  });

  it("sends the maxId cursor to Instagram (pagination regression)", async () => {
    const feed = fakeFeed([{ items: [post("3_7")] }]);
    stubInstagram({ feed: { user: jest.fn(() => feed) } });

    const result = await call(connection, "instagram_get_user_posts", { userId: "7", maxId: "cursor-2" });

    expect(feed.requestedWith).toEqual(["cursor-2"]);
    const data = result.structuredContent as Record<string, any>;
    expect(data.moreAvailable).toBe(false);
    expect(data.nextMaxId).toBeUndefined();
  });

  it("truncates long captions in list results", async () => {
    const feed = fakeFeed([{ items: [post("4_7", { caption: { text: "a".repeat(400) } })] }]);
    stubInstagram({ feed: { user: jest.fn(() => feed) } });
    const result = await call(connection, "instagram_get_user_posts", { userId: "7" });
    const first = (result.structuredContent as Record<string, any>).posts[0];
    expect(first.caption).toHaveLength(301);
    expect(first.captionTruncated).toBe(true);
  });

  it("lists every item of a carousel and the video of a video post", async () => {
    const feed = fakeFeed([
      {
        items: [
          post("5_7", {
            media_type: 8,
            carousel_media: [
              { image_versions2: { candidates: [{ url: "https://cdn.example/c1.jpg", width: 1, height: 1 }] } },
              { video_versions: [{ url: "https://cdn.example/c2.mp4", width: 2, height: 2 }] },
            ],
          }),
          post("6_7", { media_type: 2, video_versions: [{ url: "https://cdn.example/v.mp4", width: 720, height: 1280 }] }),
        ],
      },
    ]);
    stubInstagram({ feed: { user: jest.fn(() => feed) } });
    const result = await call(connection, "instagram_get_user_posts", { userId: "7" });
    const [carousel, video] = (result.structuredContent as Record<string, any>).posts;
    expect(carousel.type).toBe("carousel");
    expect(carousel.mediaUrls).toEqual(["https://cdn.example/c1.jpg", "https://cdn.example/c2.mp4"]);
    expect(video.type).toBe("video");
    expect(video.mediaUrls[0]).toBe("https://cdn.example/v.mp4");
  });
});

describe("Instagram error translation", () => {
  it.each([
    [new IgNotFoundError(fakeResponse(404)), 'User "ghost" was not found'],
    [new IgLoginRequiredError(fakeResponse(403, { message: "login_required" })), "instagram_login"],
    [new IgActionSpamError(fakeResponse(400, { spam: true })), "spam"],
    [new IgResponseError(fakeResponse(429)), "rate limit"],
  ])("maps %p to an actionable message", async (error, message) => {
    stubInstagram({ user: { usernameinfo: jest.fn(async () => Promise.reject(error)) } });
    const result = await call(connection, "instagram_get_user_posts", { username: "ghost" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(message);
  });

  it("does not leak stack traces", async () => {
    stubInstagram({ user: { usernameinfo: jest.fn(async () => Promise.reject(new Error("boom"))) } });
    const result = await call(connection, "instagram_get_user_posts", { username: "ghost" });
    expect(textOf(result)).toContain("boom");
    expect(textOf(result)).not.toMatch(/\bat .+\.(ts|js):\d+/);
  });
});

describe("write tools", () => {
  it("instagram_like_post likes with the default module", async () => {
    const like = jest.fn(async () => ({}));
    stubInstagram({ media: { like } });
    const result = await call(connection, "instagram_like_post", { mediaId: "1_7" });
    expect(result.isError).toBeFalsy();
    expect(like).toHaveBeenCalledWith({ mediaId: "1_7", moduleInfo: { module_name: "feed_timeline" }, d: 1 });
  });

  it("instagram_like_comment likes the comment", async () => {
    const likeComment = jest.fn(async () => ({}));
    stubInstagram({ media: { likeComment } });
    const result = await call(connection, "instagram_like_comment", { commentId: "1789" });
    expect(result.isError).toBeFalsy();
    expect(likeComment).toHaveBeenCalledWith("1789");
  });

  it("instagram_comment_on_post returns the new comment ID", async () => {
    const comment = jest.fn(async () => ({ pk: "555" }));
    stubInstagram({ media: { comment } });
    const result = await call(connection, "instagram_comment_on_post", {
      mediaId: "1_7",
      text: "  nice  ",
      replyToCommentId: "1789",
    });
    expect(comment).toHaveBeenCalledWith({ mediaId: "1_7", text: "nice", replyToCommentId: "1789" });
    expect(result.structuredContent).toEqual({ commentId: "555", mediaId: "1_7", replyToCommentId: "1789" });
  });

  it("instagram_follow_user reports a pending request for private accounts", async () => {
    const create = jest.fn(async () => ({ following: false, outgoing_request: true, is_private: true }));
    stubInstagram({ friendship: { create } });
    const result = await call(connection, "instagram_follow_user", { userId: "7" });
    expect(result.structuredContent).toEqual({ userId: "7", following: false, requested: true, isPrivate: true });
  });
});

describe("profile and search tools", () => {
  const rawUser = {
    pk: 7,
    username: "nasa",
    full_name: "NASA",
    is_private: false,
    is_verified: true,
    profile_pic_url: "https://cdn.example/p.jpg",
    hd_profile_pic_url_info: { url: "https://cdn.example/p-hd.jpg" },
    biography: "Exploring the universe",
    external_url: "https://nasa.gov",
    follower_count: 1000,
    following_count: 10,
    media_count: 50,
    is_business: true,
    category: "Government",
  };

  it("instagram_get_user_profile maps the profile", async () => {
    stubInstagram({ user: { usernameinfo: jest.fn(async () => rawUser) } });
    const result = await call(connection, "instagram_get_user_profile", { username: "nasa" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: "7",
      username: "nasa",
      profilePicUrl: "https://cdn.example/p-hd.jpg",
      biography: "Exploring the universe",
      followerCount: 1000,
      followingCount: 10,
      postCount: 50,
      accountType: "business",
      category: "Government",
    });
  });

  it("instagram_get_current_user_profile merges account and profile data", async () => {
    stubInstagram({
      account: {
        currentUser: jest.fn(async () => ({ pk: 7, username: "nasa", email: "me@example.com", phone_number: "+15550100" })),
      },
      user: { info: jest.fn(async () => rawUser) },
    });
    const result = await call(connection, "instagram_get_current_user_profile");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ username: "nasa", followerCount: 1000 });
    // The private login email/phone must not reach the model's context.
    expect(JSON.stringify(result)).not.toContain("me@example.com");
  });

  it("instagram_search_accounts applies the limit and reports the total", async () => {
    const users = [rawUser, { ...rawUser, pk: 8, username: "nasa2" }, { ...rawUser, pk: 9, username: "nasa3" }];
    stubInstagram({ user: { search: jest.fn(async () => ({ users })) } });
    const result = await call(connection, "instagram_search_accounts", { query: " nasa ", limit: 2 });
    const data = result.structuredContent as Record<string, any>;
    expect(data.query).toBe("nasa");
    expect(data.accounts.map((account: { username: string }) => account.username)).toEqual(["nasa", "nasa2"]);
    expect(data.totalMatches).toBe(3);
  });
});

describe("post, comment, story and timeline tools", () => {
  it("instagram_get_post_details returns the full caption and dimensions", async () => {
    const longCaption = `${"a".repeat(400)} #space @nasa`;
    stubInstagram({
      media: {
        info: jest.fn(async () => ({
          items: [post("1_7", { caption: { text: longCaption }, original_width: 1080, original_height: 1350 })],
        })),
      },
    });
    const result = await call(connection, "instagram_get_post_details", { mediaId: "1_7" });
    expect(result.structuredContent).toMatchObject({
      id: "1_7",
      caption: longCaption,
      width: 1080,
      height: 1350,
      hasHashtags: true,
      hasMentions: true,
    });
  });

  it("instagram_get_post_details reports a missing post", async () => {
    stubInstagram({ media: { info: jest.fn(async () => ({ items: [] })) } });
    const result = await call(connection, "instagram_get_post_details", { mediaId: "1_7" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not found");
  });

  it("instagram_get_post_comments maps comments and pages with max_id", async () => {
    const feed = fakeFeed([
      {
        items: [
          {
            pk: "111",
            text: "great shot",
            comment_like_count: 4,
            child_comment_count: 1,
            created_at: 1_700_000_000,
            user: { pk: 9, username: "fan" },
          },
        ],
        nextMaxId: "c-2",
      },
    ]);
    stubInstagram({ feed: { mediaComments: jest.fn(() => feed) } });
    const result = await call(connection, "instagram_get_post_comments", { mediaId: "1_7" });
    const data = result.structuredContent as Record<string, any>;
    expect(data.comments[0]).toMatchObject({
      id: "111",
      text: "great shot",
      likeCount: 4,
      replyCount: 1,
      author: { username: "fan" },
    });
    expect(data.nextMaxId).toBe("c-2");
  });

  it("instagram_get_post_comments round-trips a min_id cursor", async () => {
    const feed = {
      nextMaxId: undefined as string | undefined,
      nextMinId: undefined as string | undefined,
      sentMinId: undefined as string | undefined,
      async items() {
        feed.sentMinId = feed.nextMinId;
        feed.nextMinId = "older-2";
        return [];
      },
      isMoreAvailable: () => true,
    };
    stubInstagram({ feed: { mediaComments: jest.fn(() => feed) } });
    const result = await call(connection, "instagram_get_post_comments", { mediaId: "1_7", maxId: "min:older-1" });
    expect(feed.sentMinId).toBe("older-1");
    expect(result.structuredContent).toMatchObject({ moreAvailable: true, nextMaxId: "min:older-2" });
  });

  it("instagram_get_post_comments keeps paging in the min_id direction when both cursors come back", async () => {
    const feed = {
      nextMaxId: undefined as string | undefined,
      nextMinId: undefined as string | undefined,
      async items() {
        feed.nextMaxId = "newer-1";
        feed.nextMinId = "older-2";
        return [];
      },
      isMoreAvailable: () => true,
    };
    stubInstagram({ feed: { mediaComments: jest.fn(() => feed) } });
    const result = await call(connection, "instagram_get_post_comments", { mediaId: "1_7", maxId: "min:older-1" });
    expect(result.structuredContent).toMatchObject({ nextMaxId: "min:older-2" });
  });

  it("instagram_get_user_stories maps active stories", async () => {
    const items = [
      {
        id: "s1",
        media_type: 2,
        taken_at: 1_700_000_000,
        video_duration: 5,
        video_versions: [{ url: "https://cdn.example/s1.mp4", width: 720, height: 1280 }],
        story_polls: [{}],
        user: { username: "nasa" },
      },
    ];
    stubInstagram({ feed: { userStory: jest.fn(() => ({ items: async () => items })) } });
    const result = await call(connection, "instagram_get_user_stories", { userId: "7" });
    const data = result.structuredContent as Record<string, any>;
    expect(data.username).toBe("nasa");
    expect(data.stories[0]).toMatchObject({
      id: "s1",
      type: "video",
      videoDurationSeconds: 5,
      stickerTypes: ["poll"],
      expiresAt: "2023-11-15T22:13:20.000Z",
      mediaUrls: ["https://cdn.example/s1.mp4"],
    });
  });

  it("instagram_get_timeline_feed flags sponsored posts and pages", async () => {
    const feed = fakeFeed([{ items: [post("1_7"), post("2_8", { ad_id: "ad-1" })], nextMaxId: "t-2" }]);
    stubInstagram({ feed: { timeline: jest.fn(() => feed) } });
    const result = await call(connection, "instagram_get_timeline_feed", { maxId: "t-1" });
    const data = result.structuredContent as Record<string, any>;
    expect(feed.requestedWith).toEqual(["t-1"]);
    expect(data.posts[0].sponsored).toBeUndefined();
    expect(data.posts[1].sponsored).toBe(true);
    expect(data.nextMaxId).toBe("t-2");
  });
});

describe("rate limiting", () => {
  afterEach(() => {
    delete process.env.IG_RATE_LIMITS;
    resetRateLimiter();
  });

  it("refuses a write over the limit without contacting Instagram", async () => {
    process.env.IG_RATE_LIMITS = JSON.stringify({ comment: { perMinute: 1 } });
    resetRateLimiter();
    const comment = jest.fn(async () => ({ pk: "1" }));
    stubInstagram({ media: { comment } });

    const first = await call(connection, "instagram_comment_on_post", { mediaId: "1_7", text: "one" });
    const second = await call(connection, "instagram_comment_on_post", { mediaId: "1_7", text: "two" });

    expect(first.isError).toBeFalsy();
    expect(second.isError).toBe(true);
    expect(textOf(second)).toMatch(/Rate limit reached.*Try again in/s);
    expect(comment).toHaveBeenCalledTimes(1);
  });

  it("does not count calls rejected for a missing session", async () => {
    process.env.IG_RATE_LIMITS = JSON.stringify({ follow: { perMinute: 1 } });
    resetRateLimiter();
    stubInstagram({}, { loggedIn: false });
    await call(connection, "instagram_follow_user", { userId: "7" });
    jest.restoreAllMocks();

    const create = jest.fn(async () => ({ following: true, outgoing_request: false }));
    stubInstagram({ friendship: { create } });
    const result = await call(connection, "instagram_follow_user", { userId: "7" });
    expect(result.isError).toBeFalsy();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
