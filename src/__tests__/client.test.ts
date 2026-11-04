/**
 * Unit tests for IGPAPIClient session-validation helpers
 */

import {
  IgCookieNotFoundError,
  IgLoginRequiredError,
  IgNetworkError,
  IgUserHasLoggedOutError,
} from "instagram-private-api";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { IgApiClient } from "instagram-private-api";
import { setConfig } from "../config/index.js";
import {
  createIgClient,
  IGPAPIClient,
  isInvalidSessionError,
  LOGIN_CANCELLED_MESSAGE,
  REQUEST_TIMEOUT_MS,
} from "../igpapi/client.js";
import { getSessionFilePath, sessionExists } from "../igpapi/session.js";
import { RateLimitError, resetRateLimiter } from "../utils/rateLimit.js";

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

describe("createIgClient", () => {
  it("re-enables TLS certificate checks and sets a timeout on every request", async () => {
    const ig = createIgClient();
    let sent: Record<string, unknown> | undefined;
    (ig.request as unknown as { faultTolerantRequest: (o: Record<string, unknown>) => Promise<never> }).faultTolerantRequest =
      async (options) => {
        sent = options;
        throw new Error("stop before the network");
      };
    await expect(ig.request.send({ url: "/api/v1/accounts/current_user/" })).rejects.toThrow("stop before the network");
    expect(sent?.strictSSL).toBe(true);
    expect(sent?.timeout).toBe(REQUEST_TIMEOUT_MS);
  });
});

describe("IGPAPIClient.initialize", () => {
  const savedEnv = { IG_SESSION_DIR: process.env.IG_SESSION_DIR, IG_RATE_LIMITS: process.env.IG_RATE_LIMITS };
  let sessionDir: string;

  beforeEach(async () => {
    sessionDir = await fs.mkdtemp(join(tmpdir(), "mcp-instagram-client-"));
    process.env.IG_SESSION_DIR = sessionDir;
    // These tests log in several times within a minute.
    process.env.IG_RATE_LIMITS = '{"login":{"perMinute":100,"perHour":100,"perDay":100}}';
    resetRateLimiter();
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetRateLimiter();
    setConfig({ igpapi: {} });
    jest.restoreAllMocks();
    await fs.rm(sessionDir, { recursive: true, force: true });
  });

  /** Writes a saved session, optionally carrying a ds_user cookie. */
  async function writeSavedSession(cookieUsername?: string) {
    const ig = createIgClient();
    ig.state.generateDevice("seed");
    if (cookieUsername) {
      await ig.state.cookieJar.setCookie(
        `ds_user=${cookieUsername}; Domain=.instagram.com; Path=/`,
        "https://i.instagram.com/"
      );
    }
    await fs.writeFile(getSessionFilePath(), JSON.stringify(await ig.state.serialize()));
  }

  /** Stubs AccountRepository.currentUser for every IgApiClient. */
  function stubCurrentUser(username: string) {
    const proto = Object.getPrototypeOf(createIgClient().account) as { currentUser: () => Promise<unknown> };
    return jest.spyOn(proto, "currentUser").mockResolvedValue({ username, pk: 1 } as never);
  }

  it("discards a saved session whose cookie names another account, without contacting Instagram", async () => {
    await writeSavedSession("mallory");
    setConfig({ igpapi: { username: "alice" } });
    const currentUser = stubCurrentUser("mallory");
    const errors = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const client = new IGPAPIClient();
    await client.initialize();

    expect(client.isLoggedIn()).toBe(false);
    expect(await sessionExists()).toBe(false);
    expect(currentUser).not.toHaveBeenCalled();
    expect(String(errors.mock.calls[0]?.[0])).toContain("belongs to @mallory");
  });

  it("discards a saved session when Instagram reports another account", async () => {
    await writeSavedSession();
    setConfig({ igpapi: { username: "@Alice" } });
    stubCurrentUser("mallory");
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const client = new IGPAPIClient();
    await client.initialize();

    expect(client.isLoggedIn()).toBe(false);
    expect(await sessionExists()).toBe(false);
  });

  it("restores a saved session for the configured account", async () => {
    await writeSavedSession("alice");
    setConfig({ igpapi: { username: "Alice" } });
    stubCurrentUser("alice");

    const client = new IGPAPIClient();
    await client.initialize();

    expect(client.isLoggedIn()).toBe(true);
    expect(client.getUsername()).toBe("alice");
    expect(await sessionExists()).toBe(true);
  });

  it("skips the account check when IG_USERNAME is an email or phone number", async () => {
    for (const login of ["alice@example.com", "15551234567"]) {
      await writeSavedSession("alice_ig");
      setConfig({ igpapi: { username: login } });
      jest.restoreAllMocks();
      stubCurrentUser("alice_ig");

      const client = new IGPAPIClient();
      await client.initialize();
      expect(client.isLoggedIn()).toBe(true);
    }
  });

  it("rate limits password logins before contacting Instagram", async () => {
    delete process.env.IG_RATE_LIMITS;
    resetRateLimiter();
    const client = new IGPAPIClient();
    await client.initialize();
    let attempts = 0;
    stubLogin(client.getClient(), async () => {
      attempts++;
      return { username: "alice" };
    });

    await client.login("alice", "secret");
    await expect(client.login("alice", "secret")).rejects.toBeInstanceOf(RateLimitError);
    expect(attempts).toBe(1);
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
