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
import type { IgApiClient } from "instagram-private-api";
import {
  IGPAPIClient,
  isInvalidSessionError,
  LOGIN_CANCELLED_MESSAGE,
  REQUEST_TIMEOUT_MS,
} from "../igpapi/client.js";
import { sessionExists } from "../igpapi/session.js";

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

  /** Replaces account.login on the client's current IgApiClient. */
  function stubLogin(ig: IgApiClient, impl: () => Promise<unknown>) {
    (ig.account as unknown as { login: () => Promise<unknown> }).login = impl;
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("abandons a login that a logout overtook", async () => {
    const client = new IGPAPIClient();
    await client.initialize();
    const gate = deferred();
    stubLogin(client.getClient(), () => gate.promise);

    const inFlight = client.login("alice", "secret");
    await client.logout();
    gate.resolve();

    await expect(inFlight).rejects.toThrow(LOGIN_CANCELLED_MESSAGE);
    expect(client.isLoggedIn()).toBe(false);
    expect(client.getUsername()).toBeNull();
    expect(await sessionExists()).toBe(false);
  });

  it("keeps a login made after logout when an older login finishes later", async () => {
    const client = new IGPAPIClient();
    await client.initialize();
    const gate = deferred();
    stubLogin(client.getClient(), () => gate.promise);
    const stale = client.login("alice", "secret");

    await client.logout();
    await client.initialize();
    stubLogin(client.getClient(), async () => ({}));
    await client.login("alice", "secret");
    expect(client.isLoggedIn()).toBe(true);
    expect(await sessionExists()).toBe(true);

    gate.resolve();
    await expect(stale).rejects.toThrow(LOGIN_CANCELLED_MESSAGE);
    expect(client.isLoggedIn()).toBe(true);
    expect(client.getUsername()).toBe("alice");
    expect(await sessionExists()).toBe(true);
  });

  it("bounds every Instagram request with a timeout", async () => {
    const client = new IGPAPIClient();
    await client.initialize();
    expect(client.isLoggedIn()).toBe(false);
    expect(client.getClient().request.defaults.timeout).toBe(REQUEST_TIMEOUT_MS);
  });
});
