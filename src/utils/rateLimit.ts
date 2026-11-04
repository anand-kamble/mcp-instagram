/**
 * Server-side rate limiting for write actions (like, comment, follow) and
 * password logins.
 *
 * The MCP tools spec requires servers to rate limit tool invocations, and
 * Instagram action-blocks accounts that like, comment or follow in fast
 * bursts, and checkpoints accounts that log in with a password repeatedly.
 * Without a limit, an agent loop can get the account blocked.
 *
 * Limits are per server process and kept in memory, so they reset on restart.
 * Instagram does not publish its limits; the defaults below are deliberately
 * conservative and can be changed with the IG_RATE_LIMITS environment
 * variable, a JSON object of partial overrides, for example:
 *
 *   IG_RATE_LIMITS='{"like":{"perHour":100},"follow":{"perDay":50}}'
 */

export type RateLimitedAction = "like" | "unlike" | "comment" | "follow" | "unfollow" | "login";

/** Actions that undo each other share one budget: unliking still counts as activity. */
export type RateLimitBucket = "like" | "comment" | "follow" | "login";

export interface BucketLimits {
  perMinute: number;
  perHour: number;
  perDay: number;
}

export type RateLimits = Record<RateLimitBucket, BucketLimits>;

export const DEFAULT_RATE_LIMITS: Readonly<RateLimits> = Object.freeze({
  like: Object.freeze({ perMinute: 10, perHour: 60, perDay: 500 }),
  comment: Object.freeze({ perMinute: 3, perHour: 20, perDay: 100 }),
  follow: Object.freeze({ perMinute: 5, perHour: 30, perDay: 150 }),
  login: Object.freeze({ perMinute: 1, perHour: 5, perDay: 10 }),
});

const ACTION_BUCKET: Record<RateLimitedAction, RateLimitBucket> = {
  like: "like",
  unlike: "like",
  comment: "comment",
  follow: "follow",
  unfollow: "follow",
  login: "login",
};

const BUCKET_LABEL: Record<RateLimitBucket, string> = {
  like: "like/unlike",
  comment: "comment",
  follow: "follow/unfollow",
  login: "password login",
};

const BUCKET_REASON: Record<RateLimitBucket, string> = {
  like: "This server limits likes, comments and follows so the Instagram account is not action-blocked.",
  comment: "This server limits likes, comments and follows so the Instagram account is not action-blocked.",
  follow: "This server limits likes, comments and follows so the Instagram account is not action-blocked.",
  login: "Repeated password logins make Instagram lock the account behind a security checkpoint.",
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WINDOWS: ReadonlyArray<{ key: keyof BucketLimits; ms: number; label: string }> = [
  { key: "perMinute", ms: MINUTE_MS, label: "minute" },
  { key: "perHour", ms: HOUR_MS, label: "hour" },
  { key: "perDay", ms: DAY_MS, label: "day" },
];

export class RateLimitError extends Error {
  readonly code = "RATE_LIMITED";

  constructor(
    message: string,
    readonly action: RateLimitedAction,
    readonly retryAfterMs: number
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/** "45s", "2m 5s", "1h 3m". Rounds up to the next second. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Sliding-window limiter. Each bucket keeps the timestamps of the last day's
 * actions; an action is allowed only if every window still has room.
 */
export class RateLimiter {
  private readonly history = new Map<RateLimitBucket, number[]>();

  constructor(
    private readonly limits: Readonly<RateLimits> = DEFAULT_RATE_LIMITS,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Record one `action`, or throw RateLimitError (without recording) if any
   * window for its bucket is full.
   */
  consume(action: RateLimitedAction): void {
    const bucket = ACTION_BUCKET[action];
    const limits = this.limits[bucket];
    const t = this.now();
    // Timestamps are appended in order, so the array stays sorted ascending.
    const events = (this.history.get(bucket) ?? []).filter((ts) => t - ts < DAY_MS);
    this.history.set(bucket, events);

    let retryAfterMs = 0;
    let blocking: { max: number; label: string } | null = null;
    for (const window of WINDOWS) {
      const max = limits[window.key];
      const inWindow = events.filter((ts) => t - ts < window.ms);
      if (inWindow.length >= max) {
        // Room opens when the (n - max)th event in the window ages out.
        const wait = inWindow[inWindow.length - max] + window.ms - t;
        if (wait > retryAfterMs) {
          retryAfterMs = wait;
          blocking = { max, label: window.label };
        }
      }
    }

    if (blocking) {
      throw new RateLimitError(
        `Rate limit reached: at most ${blocking.max} ${BUCKET_LABEL[bucket]} actions per ${blocking.label}. ` +
          `Try again in ${formatDuration(retryAfterMs)}. ` +
          BUCKET_REASON[bucket],
        action,
        retryAfterMs
      );
    }

    events.push(t);
  }
}

/**
 * Parse IG_RATE_LIMITS (a JSON object of partial overrides) onto the defaults.
 * Throws on unknown keys or values that are not positive integers.
 */
export function parseRateLimits(json: string | undefined): RateLimits {
  const limits: RateLimits = {
    like: { ...DEFAULT_RATE_LIMITS.like },
    comment: { ...DEFAULT_RATE_LIMITS.comment },
    follow: { ...DEFAULT_RATE_LIMITS.follow },
    login: { ...DEFAULT_RATE_LIMITS.login },
  };
  if (json === undefined || json.trim() === "") {
    return limits;
  }

  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("IG_RATE_LIMITS must be a JSON object");
  }
  for (const [bucket, overrides] of Object.entries(parsed)) {
    if (!Object.hasOwn(limits, bucket)) {
      throw new Error(`IG_RATE_LIMITS: unknown action "${bucket}" (expected like, comment, follow or login)`);
    }
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
      throw new Error(`IG_RATE_LIMITS.${bucket} must be an object`);
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (!WINDOWS.some((w) => w.key === key)) {
        throw new Error(`IG_RATE_LIMITS.${bucket}: unknown key "${key}" (expected perMinute, perHour or perDay)`);
      }
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`IG_RATE_LIMITS.${bucket}.${key} must be a positive integer`);
      }
      limits[bucket as RateLimitBucket][key as keyof BucketLimits] = value;
    }
  }
  return limits;
}

let defaultLimiter: RateLimiter | null = null;

function getDefaultLimiter(): RateLimiter {
  if (!defaultLimiter) {
    let limits: RateLimits;
    try {
      limits = parseRateLimits(process.env.IG_RATE_LIMITS);
    } catch (error) {
      console.error(
        `[mcp-instagram] Ignoring invalid IG_RATE_LIMITS, using defaults: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      limits = parseRateLimits(undefined);
    }
    defaultLimiter = new RateLimiter(limits);
  }
  return defaultLimiter;
}

/**
 * Record one write action against the process-wide limiter.
 * Call this before the Instagram request. Throws RateLimitError when over a limit.
 */
export function consumeRateLimit(action: RateLimitedAction): void {
  getDefaultLimiter().consume(action);
}

/** Drop the process-wide limiter so the next call re-reads IG_RATE_LIMITS. For tests. */
export function resetRateLimiter(): void {
  defaultLimiter = null;
}
