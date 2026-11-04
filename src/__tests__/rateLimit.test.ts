/**
 * Unit tests for the write-action rate limiter
 */

import {
  DEFAULT_RATE_LIMITS,
  RateLimiter,
  RateLimitError,
  consumeRateLimit,
  formatDuration,
  parseRateLimits,
  resetRateLimiter,
} from "../utils/rateLimit.js";

function limiterAt(start: number, limits = parseRateLimits(undefined)) {
  let now = start;
  const limiter = new RateLimiter(limits, () => now);
  return {
    limiter,
    advance(ms: number) {
      now += ms;
    },
  };
}

/** Run fn with console.error captured; returns the logged lines. */
function captureConsoleError(fn: () => void): string[] {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

function catchError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

describe("RateLimiter", () => {
  it("allows actions up to the per-minute limit, then throws RateLimitError", () => {
    const { limiter } = limiterAt(0);
    for (let i = 0; i < DEFAULT_RATE_LIMITS.comment.perMinute; i++) {
      limiter.consume("comment");
    }
    const error = catchError(() => limiter.consume("comment"));
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).code).toBe("RATE_LIMITED");
    expect((error as RateLimitError).action).toBe("comment");
    expect((error as RateLimitError).retryAfterMs).toBe(60_000);
    expect((error as RateLimitError).message).toContain("per minute");
    expect((error as RateLimitError).message).toContain("Try again in 1m");
  });

  it("reports the wait until the oldest action in the window ages out", () => {
    const { limiter, advance } = limiterAt(1_000_000);
    // perMinute for comment is 3: actions at t=0s, 10s, 20s
    limiter.consume("comment");
    advance(10_000);
    limiter.consume("comment");
    advance(10_000);
    limiter.consume("comment");
    advance(5_000); // t=25s
    const error = catchError(() => limiter.consume("comment")) as RateLimitError;
    expect(error.retryAfterMs).toBe(35_000);
    advance(35_000); // t=60s, first action has aged out
    expect(() => limiter.consume("comment")).not.toThrow();
  });

  it("does not record rejected attempts", () => {
    const { limiter, advance } = limiterAt(0);
    for (let i = 0; i < 3; i++) limiter.consume("comment");
    for (let i = 0; i < 5; i++) expect(() => limiter.consume("comment")).toThrow(RateLimitError);
    advance(60_000);
    // Only the 3 accepted actions count; the window is empty again.
    for (let i = 0; i < 3; i++) limiter.consume("comment");
  });

  it("enforces the hourly limit even when each minute is under its limit", () => {
    const { limiter, advance } = limiterAt(0);
    // comment: 3/min, 20/hour. Spread 20 actions 30s apart (2 per minute).
    for (let i = 0; i < 20; i++) {
      limiter.consume("comment");
      advance(30_000);
    }
    // t = 600s. The first action (t=0) leaves the hour window at t=3600s.
    const error = catchError(() => limiter.consume("comment")) as RateLimitError;
    expect(error.message).toContain("per hour");
    expect(error.retryAfterMs).toBe(3_600_000 - 600_000);
  });

  it("enforces the daily limit", () => {
    const limits = parseRateLimits('{"follow":{"perMinute":100,"perHour":100,"perDay":4}}');
    const { limiter, advance } = limiterAt(0, limits);
    for (let i = 0; i < 4; i++) {
      limiter.consume("follow");
      advance(2 * 3_600_000);
    }
    const error = catchError(() => limiter.consume("follow")) as RateLimitError;
    expect(error.message).toContain("per day");
    // first follow at t=0, now t=8h, so it ages out in 16h
    expect(error.retryAfterMs).toBe(16 * 3_600_000);
  });

  it("shares a budget between like and unlike, and between follow and unfollow", () => {
    const { limiter } = limiterAt(0);
    for (let i = 0; i < DEFAULT_RATE_LIMITS.like.perMinute; i++) {
      limiter.consume(i % 2 === 0 ? "like" : "unlike");
    }
    expect(() => limiter.consume("unlike")).toThrow(RateLimitError);
    expect(() => limiter.consume("like")).toThrow(RateLimitError);

    for (let i = 0; i < DEFAULT_RATE_LIMITS.follow.perMinute; i++) {
      limiter.consume("follow");
    }
    expect(() => limiter.consume("unfollow")).toThrow(RateLimitError);
  });

  it("limits password logins to one per minute by default", () => {
    const { limiter, advance } = limiterAt(0);
    limiter.consume("login");
    const error = catchError(() => limiter.consume("login")) as RateLimitError;
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.message).toContain("password login");
    expect(error.message).toContain("checkpoint");
    advance(60_000);
    expect(() => limiter.consume("login")).not.toThrow();
  });

  it("keeps buckets independent", () => {
    const { limiter } = limiterAt(0);
    for (let i = 0; i < DEFAULT_RATE_LIMITS.comment.perMinute; i++) limiter.consume("comment");
    expect(() => limiter.consume("comment")).toThrow(RateLimitError);
    expect(() => limiter.consume("like")).not.toThrow();
    expect(() => limiter.consume("follow")).not.toThrow();
  });
});

describe("parseRateLimits", () => {
  it("returns the defaults when unset or blank", () => {
    expect(parseRateLimits(undefined)).toEqual(DEFAULT_RATE_LIMITS);
    expect(parseRateLimits("  ")).toEqual(DEFAULT_RATE_LIMITS);
  });

  it("applies partial overrides on top of the defaults", () => {
    const limits = parseRateLimits('{"like":{"perHour":100}}');
    expect(limits.like).toEqual({ ...DEFAULT_RATE_LIMITS.like, perHour: 100 });
    expect(limits.comment).toEqual(DEFAULT_RATE_LIMITS.comment);
  });

  it("does not mutate the defaults", () => {
    parseRateLimits('{"like":{"perHour":1}}');
    expect(DEFAULT_RATE_LIMITS.like.perHour).toBe(60);
  });

  it.each([
    ["not json", /JSON/],
    ["[]", /must be a JSON object/],
    ['{"likes":{}}', /unknown action "likes"/],
    ['{"like":5}', /must be an object/],
    ['{"like":{"perWeek":5}}', /unknown key "perWeek"/],
    ['{"like":{"perHour":0}}', /positive integer/],
    ['{"like":{"perHour":1.5}}', /positive integer/],
    ['{"like":{"perHour":"10"}}', /positive integer/],
    ['{"__proto__":{"perMinute":7}}', /unknown action "__proto__"/],
    ['{"constructor":{"perMinute":7}}', /unknown action "constructor"/],
  ])("rejects %s", (input, message) => {
    expect(() => parseRateLimits(input)).toThrow(message);
  });
});

describe("formatDuration", () => {
  it.each([
    [1, "1s"],
    [999, "1s"],
    [45_000, "45s"],
    [60_000, "1m"],
    [125_000, "2m 5s"],
    [3_600_000, "1h"],
    [3_780_000, "1h 3m"],
  ])("formats %d ms as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("consumeRateLimit", () => {
  const original = process.env.IG_RATE_LIMITS;

  afterEach(() => {
    if (original === undefined) delete process.env.IG_RATE_LIMITS;
    else process.env.IG_RATE_LIMITS = original;
    resetRateLimiter();
  });

  it("reads limits from IG_RATE_LIMITS", () => {
    process.env.IG_RATE_LIMITS = '{"comment":{"perMinute":1}}';
    resetRateLimiter();
    consumeRateLimit("comment");
    expect(() => consumeRateLimit("comment")).toThrow(RateLimitError);
  });

  it("falls back to the defaults when IG_RATE_LIMITS is invalid", () => {
    process.env.IG_RATE_LIMITS = "{oops";
    resetRateLimiter();
    const logged = captureConsoleError(() => {
      for (let i = 0; i < DEFAULT_RATE_LIMITS.comment.perMinute; i++) consumeRateLimit("comment");
    });
    expect(() => consumeRateLimit("comment")).toThrow(RateLimitError);
    expect(logged.join("\n")).toContain("Ignoring invalid IG_RATE_LIMITS");
  });
});
