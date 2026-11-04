/**
 * Access to the shared Instagram client from tool handlers, plus error
 * translation.
 */

import { InstagramApi } from "../../instagram/api.js";
import {
  IgActionSpamError,
  IgCheckpointError,
  IgLoginRequiredError,
  IgNetworkError,
  IgNoSessionError,
  IgNotFoundError,
  IgPrivateUserError,
  IgRateLimitedError,
  IgResponseError,
  IgSentryBlockError,
  IgUserHasLoggedOutError,
} from "../../instagram/errors.js";
import { igpapiClient } from "../../igpapi/index.js";

/** How long tool calls wait for startup session restore before giving up on it. */
export const STARTUP_WAIT_MS = 35_000;

let startup: Promise<unknown> | undefined;

/**
 * Settles with the promise's value, or `{ done: false }` after `ms`.
 * Rejections propagate. The timer does not keep the process alive.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<{ done: true; value: T } | { done: false }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise.then((value) => ({ done: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers the server's startup work (session restore / auto-login) so tool
 * calls that arrive while it is still running wait for it instead of seeing
 * a half-initialised client.
 */
export function setStartupPromise(promise: Promise<unknown>): void {
  // Never let a failed startup reject every later tool call.
  startup = promise.catch(() => undefined);
}

/**
 * Waits for startup, but at most STARTUP_WAIT_MS. If Instagram stalls during
 * session restore, tools stop waiting (they then report "not logged in")
 * instead of every call hanging. Later calls don't wait again. A startup
 * login that finishes after a logout is discarded by IGPAPIClient's auth
 * epoch, so it cannot resurrect a session.
 */
export async function waitForStartup(): Promise<void> {
  if (!startup) {
    return;
  }
  const outcome = await withTimeout(startup, STARTUP_WAIT_MS);
  if (!outcome.done) {
    startup = undefined;
    console.error(
      `[mcp-instagram] Session restore did not finish within ${STARTUP_WAIT_MS / 1000}s; continuing without it.`
    );
  }
}

/** Returns the Instagram API for the shared client, initialising it if necessary. */
export async function getApi(): Promise<InstagramApi> {
  await waitForStartup();
  if (!igpapiClient.isInitialized()) {
    await igpapiClient.initialize();
  }
  return new InstagramApi(igpapiClient.getClient());
}

/** Returns the Instagram API, or throws a user-facing error if there is no session. */
export async function getLoggedInApi(): Promise<InstagramApi> {
  const api = await getApi();
  if (!igpapiClient.isLoggedIn()) {
    throw new Error("Not logged in to Instagram. Call the instagram_login tool first.");
  }
  return api;
}

/** Strips a leading "@" from a username. */
export function normalizeUsername(username: string): string {
  return username.replace(/^@/, "");
}

/** Resolves a user ID from either a numeric ID or a username. */
export async function resolveUserId(
  api: InstagramApi,
  target: { userId?: string; username?: string }
): Promise<string> {
  if (target.userId) {
    return target.userId;
  }
  if (target.username) {
    const info = await api.usernameInfo(normalizeUsername(target.username));
    return String(info.pk);
  }
  throw new Error("Provide either userId or username.");
}

/**
 * Converts errors thrown by the Instagram client into errors whose message is
 * actionable for the model. The SDK turns a thrown error into an `isError`
 * tool result carrying `error.message`.
 *
 * @param subject Human-readable description of what was being accessed,
 *   e.g. `user "nasa"` or `media 123_456`. Used in not-found messages.
 */
export function toToolError(error: unknown, subject?: string): Error {
  if (
    error instanceof IgLoginRequiredError ||
    error instanceof IgUserHasLoggedOutError ||
    error instanceof IgNoSessionError
  ) {
    return new Error(
      "The Instagram session is missing or has expired. Call the instagram_login tool to sign in again."
    );
  }
  if (error instanceof IgCheckpointError) {
    return new Error(
      "Instagram requires a security checkpoint for this account. Approve the login in the Instagram app, then call instagram_login again."
    );
  }
  if (error instanceof IgActionSpamError || error instanceof IgSentryBlockError) {
    return new Error(
      "Instagram blocked this action as automated or spam-like activity. Stop write actions on this account for several hours."
    );
  }
  if (error instanceof IgRateLimitedError) {
    return new Error("Instagram rate limit reached. Wait several minutes before retrying.");
  }
  if (error instanceof IgPrivateUserError) {
    return new Error(
      `${subject ? capitalize(subject) : "This account"} is private. Only approved followers can see its content.`
    );
  }
  if (error instanceof IgNotFoundError) {
    return new Error(`${subject ? capitalize(subject) : "The requested item"} was not found on Instagram.`);
  }
  if (error instanceof IgResponseError) {
    const detail = typeof error.body.message === "string" && error.body.message ? error.body.message : error.message;
    return new Error(`Instagram API error (HTTP ${error.status}): ${detail}`);
  }
  if (error instanceof IgNetworkError) {
    return new Error(`Network error while contacting Instagram: ${error.message}`);
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
