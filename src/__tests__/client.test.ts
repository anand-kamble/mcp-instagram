/**
 * Unit tests for IGPAPIClient session-validation helpers
 */

import {
  IgCookieNotFoundError,
  IgLoginRequiredError,
  IgNetworkError,
  IgUserHasLoggedOutError,
} from "instagram-private-api";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { IGPAPIClient, isInvalidSessionError, REQUEST_TIMEOUT_MS } from "../igpapi/client.js";

function fakeResponse(statusCode: number, message: string) {
  return {
    statusCode,
    statusMessage: "Forbidden",
    body: { message },
    request: { method: "GET", uri: { path: "/api/v1/accounts/current_user/" } },
  } as never;
}

describe("isInvalidSessionError", () => {
  it("treats login_required, user_has_logged_out and missing cookies as an invalid session", () => {
    expect(isInvalidSessionError(new IgLoginRequiredError(fakeResponse(403, "login_required")))).toBe(true);
    expect(isInvalidSessionError(new IgUserHasLoggedOutError(fakeResponse(403, "user_has_logged_out")))).toBe(true);
    expect(isInvalidSessionError(new IgCookieNotFoundError("ds_user_id"))).toBe(true);
  });

  it("keeps the session on network and unknown errors", () => {
    expect(isInvalidSessionError(new IgNetworkError(new Error("ECONNRESET")))).toBe(false);
    expect(isInvalidSessionError(new Error("socket hang up"))).toBe(false);
    expect(isInvalidSessionError("weird")).toBe(false);
  });
});

describe("IGPAPIClient.initialize", () => {
  const savedSessionDir = process.env.IG_SESSION_DIR;
  let sessionDir: string;

  beforeEach(async () => {
    sessionDir = await fs.mkdtemp(join(tmpdir(), "mcp-instagram-client-"));
    process.env.IG_SESSION_DIR = sessionDir;
  });

  afterEach(async () => {
    if (savedSessionDir === undefined) delete process.env.IG_SESSION_DIR;
    else process.env.IG_SESSION_DIR = savedSessionDir;
    await fs.rm(sessionDir, { recursive: true, force: true });
  });

  it("bounds every Instagram request with a timeout", async () => {
    const client = new IGPAPIClient();
    await client.initialize();
    expect(client.isLoggedIn()).toBe(false);
    expect(client.getClient().request.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
  });
});
