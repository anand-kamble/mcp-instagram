/**
 * Access to the shared Instagram client from tool handlers, plus error
 * translation and feed-cursor helpers.
 */

import {
  IgActionSpamError,
  IgCheckpointError,
  IgInactiveUserError,
  IgLoginRequiredError,
  IgNetworkError,
  IgNotFoundError,
  IgPrivateUserError,
  IgResponseError,
  IgSentryBlockError,
  IgUserHasLoggedOutError,
} from "instagram-private-api";
import type { IgApiClient } from "instagram-private-api";
import { igpapiClient } from "../../igpapi/index.js";

let startup: Promise<unknown> | undefined;

/**
 * Registers the server's startup work (session restore / auto-login) so tool
 * calls that arrive while it is still running wait for it instead of seeing
 * a half-initialised client.
 */
export function setStartupPromise(promise: Promise<unknown>): void {
  // Never let a failed startup reject every later tool call.
  startup = promise.catch(() => undefined);
}

export async function waitForStartup(): Promise<void> {
  if (startup) {
    await startup;
  }
}

/** Returns the Instagram client, initialising it if necessary. */
export async function getClient(): Promise<IgApiClient> {
  await waitForStartup();
  if (!igpapiClient.isInitialized()) {
    await igpapiClient.initialize();
  }
  return igpapiClient.getClient();
}

/** Returns the Instagram client, or throws a user-facing error if there is no session. */
export async function getLoggedInClient(): Promise<IgApiClient> {
  const client = await getClient();
  if (!igpapiClient.isLoggedIn()) {
    throw new Error("Not logged in to Instagram. Call the instagram_login tool first.");
  }
  return client;
}

/** Strips a leading "@" from a username. */
export function normalizeUsername(username: string): string {
  return username.replace(/^@/, "");
}

/** Resolves a user ID from either a numeric ID or a username. */
export async function resolveUserId(
  client: IgApiClient,
  target: { userId?: string; username?: string }
): Promise<string> {
  if (target.userId) {
    return target.userId;
  }
  if (target.username) {
    const info = await client.user.usernameinfo(normalizeUsername(target.username));
    return String(info.pk);
  }
  throw new Error("Provide either userId or username.");
}

/**
 * Converts errors thrown by instagram-private-api into errors whose message is
 * actionable for the model. The SDK turns a thrown error into an `isError`
 * tool result carrying `error.message`.
 *
 * @param subject Human-readable description of what was being accessed,
 *   e.g. `user "nasa"` or `media 123_456`. Used in not-found messages.
 */
export function toToolError(error: unknown, subject?: string): Error {
  if (error instanceof IgLoginRequiredError || error instanceof IgUserHasLoggedOutError) {
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
  if (error instanceof IgPrivateUserError) {
    return new Error(
      `${subject ? capitalize(subject) : "This account"} is private. Only approved followers can see its content.`
    );
  }
  if (error instanceof IgNotFoundError) {
    return new Error(`${subject ? capitalize(subject) : "The requested item"} was not found on Instagram.`);
  }
  if (error instanceof IgInactiveUserError) {
    return new Error(`${subject ? capitalize(subject) : "This account"} is inactive or unavailable.`);
  }
  if (error instanceof IgResponseError) {
    const status = error.response?.statusCode;
    if (status === 429 || /wait a few minutes/i.test(error.message)) {
      return new Error("Instagram rate limit reached. Wait several minutes before retrying.");
    }
    return new Error(`Instagram API error${status ? ` (HTTP ${status})` : ""}: ${error.message}`);
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

// ---------------------------------------------------------------------------
// Feed cursors
// ---------------------------------------------------------------------------

/**
 * instagram-private-api keeps a feed's pagination cursor in the private
 * `nextMaxId` field (sent as `max_id` on the next request). These helpers set
 * and read it so a page can be resumed in a later, independent tool call.
 */
interface CursorFeed {
  isMoreAvailable(): boolean;
}

export function setFeedCursor(feed: CursorFeed, cursor: string | undefined): void {
  if (cursor) {
    (feed as unknown as { nextMaxId?: string }).nextMaxId = cursor;
  }
}

export function getFeedCursor(feed: CursorFeed): { moreAvailable: boolean; nextMaxId?: string } {
  const moreAvailable = feed.isMoreAvailable();
  const raw = (feed as unknown as { nextMaxId?: unknown }).nextMaxId;
  const nextMaxId = moreAvailable && raw !== undefined && raw !== null && raw !== "" ? String(raw) : undefined;
  return nextMaxId ? { moreAvailable, nextMaxId } : { moreAvailable };
}
