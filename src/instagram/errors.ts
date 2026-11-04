/**
 * Errors thrown by InstagramClient.
 *
 * Class names mirror the instagram-private-api errors the tool layer used to
 * map, so `toToolError` and `isInvalidSessionError` translate one to one.
 * Mapping rules follow instagrapi's private_request (MIT, see NOTICE).
 */

export class IgError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Connection failure, timeout, or a response that is not JSON. */
export class IgNetworkError extends IgError {}

/** No usable session (never logged in, or the session was cleared). */
export class IgNoSessionError extends IgError {
  constructor(message = "Not logged in to Instagram.") {
    super(message);
  }
}

export interface IgResponseInfo {
  /** HTTP status code. */
  status: number;
  /** Endpoint path relative to /api/v1/. */
  path: string;
  /** Parsed JSON body, or {} when the body was not JSON. */
  body: Record<string, unknown>;
}

/** Instagram answered with an error status or `"status": "fail"`. */
export class IgResponseError extends IgError {
  readonly status: number;
  readonly path: string;
  readonly body: Record<string, unknown>;
  /** `error_type` from the body, if any. */
  readonly errorType?: string;

  constructor(response: IgResponseInfo, message?: string) {
    const bodyMessage = typeof response.body.message === "string" ? response.body.message : "";
    super(message ?? `${response.path} - HTTP ${response.status}${bodyMessage ? `: ${bodyMessage}` : ""}`);
    this.status = response.status;
    this.path = response.path;
    this.body = response.body;
    this.errorType = typeof response.body.error_type === "string" ? response.body.error_type : undefined;
  }
}

/** `login_required`: the session is no longer valid. */
export class IgLoginRequiredError extends IgResponseError {}

/** `user_has_logged_out`: the session was ended (e.g. from another device). */
export class IgUserHasLoggedOutError extends IgResponseError {}

/** `challenge_required` (incl. the bare "Not Found" masked challenge): verify in the Instagram app. */
export class IgCheckpointError extends IgResponseError {}

/** `feedback_required`: Instagram blocked the action as spam-like. */
export class IgActionSpamError extends IgResponseError {}

/** `sentry_block`: Instagram blocked the request as automated. */
export class IgSentryBlockError extends IgResponseError {}

/** HTTP 429, `rate_limit_error`, or "Please wait a few minutes". */
export class IgRateLimitedError extends IgResponseError {}

/** HTTP 404, or a deleted/unavailable media. */
export class IgNotFoundError extends IgResponseError {}

/** "Not authorized to view user": the account is private. */
export class IgPrivateUserError extends IgResponseError {}

/** `bad_password`. */
export class IgBadPasswordError extends IgResponseError {}

/** `invalid_user`: no account with that username. */
export class IgInvalidUserError extends IgResponseError {}

/** `needs_upgrade`: Instagram rejects the emulated app version or login flow. */
export class IgNeedsUpgradeError extends IgResponseError {}

/** Two-factor code required; `twoFactorInfo` is Instagram's `two_factor_info`. */
export class IgTwoFactorRequiredError extends IgResponseError {
  get twoFactorInfo(): Record<string, unknown> | undefined {
    const info = this.body.two_factor_info;
    return info && typeof info === "object" ? (info as Record<string, unknown>) : undefined;
  }
}
