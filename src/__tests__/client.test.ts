/**
 * Unit tests for the session manager (src/igpapi/client.ts) on top of
 * InstagramClient, with a fake fetch: restore, IG_SESSION_ID login, account
 * checks, logout races and the login rate limit.
 */

import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { setConfig } from "../config/index.js";
import {
  IGPAPIClient,
  isInvalidSessionError,
  LOGIN_CANCELLED_MESSAGE,
  PASSWORD_LOGIN_UNAVAILABLE_MESSAGE,
  userIdFromSessionId,
} from "../igpapi/client.js";
import { loadSession, saveSession, sessionExists } from "../igpapi/session.js";
import {
  IgLoginRequiredError,
  IgNetworkError,
  IgNoSessionError,
  IgUserHasLoggedOutError,
  InstagramClient,
} from "../instagram/index.js";
import type { SessionState } from "../instagram/index.js";
import { RateLimitError, resetRateLimiter } from "../utils/rateLimit.js";

const SESSION_ID = "42%3AabcdefghijklmnopQRSTU%3A12%3AAYcdefghijklmnopqrstuvwxyz";

type Handler = (path: string, init: RequestInit) => Promise<Response> | Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A session manager whose InstagramClient uses `handler` instead of the network. */
function managerWith(handler: Handler) {
  const calls: string[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace("/api/v1/", "");
    calls.push(path);
    return handler(path, init ?? {});
  }) as unknown as typeof fetch;
  const manager = new IGPAPIClient({
    createClient: (session?: SessionState) => new InstagramClient({ session, fetch: fetchImpl }),
  });
  return { manager, calls };
}

const currentUser = (username: string, pk = 42) => () => json({ status: "ok", user: { pk, username } });

function savedSession(username?: string): SessionState {
  const client = new InstagramClient({ fetch: (async () => json({})) as unknown as typeof fetch });
  client.setAuthorization({ ds_user_id: "42", sessionid: SESSION_ID, should_use_header_over_cookies: true });
  client.setAccount("42", username);
  return client.serialize();
}

describe("isInvalidSessionError", () => {
  const info = { status: 403, path: "x/", body: {} };
  it("treats login_required, user_has_logged_out and a missing session as invalid", () => {
    expect(isInvalidSessionError(new IgLoginRequiredError(info))).toBe(true);
    expect(isInvalidSessionError(new IgUserHasLoggedOutError(info))).toBe(true);
    expect(isInvalidSessionError(new IgNoSessionError())).toBe(true);
  });

  it("keeps the session on network and unknown errors", () => {
    expect(isInvalidSessionError(new IgNetworkError("ECONNRESET"))).toBe(false);
    expect(isInvalidSessionError(new Error("socket hang up"))).toBe(false);
    expect(isInvalidSessionError("weird")).toBe(false);
  });
});

describe("userIdFromSessionId", () => {
  it("reads the numeric user id prefix", () => {
    expect(userIdFromSessionId(SESSION_ID)).toBe("42");
    expect(userIdFromSessionId("42:abcdefghijklmnopqrstuvwxyz0123")).toBe("42");
  });

  it("rejects values that are not sessionid cookies", () => {
    expect(userIdFromSessionId("abc%3A123")).toBeUndefined();
    expect(userIdFromSessionId("42%3Ashort")).toBeUndefined();
  });
});

describe("IGPAPIClient", () => {
  const savedEnv = { IG_SESSION_DIR: process.env.IG_SESSION_DIR, IG_RATE_LIMITS: process.env.IG_RATE_LIMITS };
  let sessionDir: string;
  const originalError = console.error;
  let logged: string[];

  beforeEach(async () => {
    sessionDir = await fs.mkdtemp(join(tmpdir(), "mcp-instagram-client-"));
    process.env.IG_SESSION_DIR = sessionDir;
    // Most tests log in several times within a minute.
    process.env.IG_RATE_LIMITS = '{"login":{"perMinute":100,"perHour":100,"perDay":100}}';
    resetRateLimiter();
    setConfig({ igpapi: {} });
    logged = [];
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.error = originalError;
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetRateLimiter();
    setConfig({ igpapi: {} });
    await fs.rm(sessionDir, { recursive: true, force: true });
  });

  describe("initialize", () => {
    it("starts logged out without a saved session or IG_SESSION_ID, and makes no requests", async () => {
      const { manager, calls } = managerWith(() => json({}));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(false);
      expect(manager.getClient().hasSession).toBe(false);
      expect(calls).toEqual([]);
    });

    it("restores and verifies a saved session", async () => {
      await saveSession(savedSession("alice"));
      const { manager, calls } = managerWith(currentUser("alice"));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(true);
      expect(manager.getUsername()).toBe("alice");
      expect(calls).toEqual(["accounts/current_user/"]);
    });

    it("deletes a saved session Instagram rejects", async () => {
      await saveSession(savedSession("alice"));
      const { manager } = managerWith(() => json({ status: "fail", message: "login_required" }, 403));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(false);
      expect(await sessionExists()).toBe(false);
    });

    it("keeps a saved session it cannot verify because of a network error", async () => {
      await saveSession(savedSession("alice"));
      const { manager } = managerWith(() => {
        throw new TypeError("fetch failed");
      });
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(true);
      expect(await sessionExists()).toBe(true);
      expect(logged.join("\n")).toContain("Could not verify the saved session");
    });

    it("discards a saved session for another account without contacting Instagram", async () => {
      await saveSession(savedSession("mallory"));
      setConfig({ igpapi: { username: "alice" } });
      const { manager, calls } = managerWith(currentUser("mallory"));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(false);
      expect(await sessionExists()).toBe(false);
      expect(calls).toEqual([]);
      expect(logged.join("\n")).toContain("belongs to @mallory");
    });

    it("discards a saved session when Instagram reports another account", async () => {
      await saveSession(savedSession());
      setConfig({ igpapi: { username: "@Alice" } });
      const { manager } = managerWith(currentUser("mallory"));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(false);
      expect(await sessionExists()).toBe(false);
    });

    it("skips the account check when IG_USERNAME is an email or phone number", async () => {
      for (const login of ["alice@example.com", "15551234567"]) {
        await saveSession(savedSession("alice_ig"));
        setConfig({ igpapi: { username: login } });
        const { manager } = managerWith(currentUser("alice_ig"));
        await manager.initialize();
        expect(manager.isLoggedIn()).toBe(true);
      }
    });

    it("loads a session file written by instagram-private-api", async () => {
      await fs.writeFile(
        join(sessionDir, "session.json"),
        JSON.stringify({
          constants: {},
          deviceString: "26/8.0.0; 480dpi; 1080x1920; samsung; SM-G930F; herolte; samsungexynos8890",
          uuid: "11111111-1111-4111-8111-111111111111",
          cookies: JSON.stringify({
            cookies: [
              { key: "sessionid", value: SESSION_ID, domain: "instagram.com" },
              { key: "ds_user_id", value: "42", domain: "instagram.com" },
            ],
          }),
        })
      );
      let authorization: string | undefined;
      const { manager } = managerWith((_path, init) => {
        authorization = (init.headers as Record<string, string>).Authorization;
        return currentUser("alice")();
      });
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(true);
      expect(manager.getClient().device.uuid).toBe("11111111-1111-4111-8111-111111111111");
      expect(authorization).toMatch(/^Bearer IGT:2:/);
    });

    it("keeps a session imported from IG_SESSION_ID after Instagram rotates it", async () => {
      setConfig({ igpapi: { sessionId: SESSION_ID } });
      const first = managerWith(currentUser("alice"));
      await first.manager.loginWithSessionId(SESSION_ID);
      const saved = await loadSession();
      expect(saved?.importedSessionId).toBe(SESSION_ID);
      // Simulate a rotated session id in the saved file.
      await saveSession({ ...saved!, authorization: { ds_user_id: "42", sessionid: "42%3Arotated-session-value-xxxxxxx" } });

      const { manager, calls } = managerWith(currentUser("alice"));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(true);
      expect((await loadSession())?.authorization?.sessionid).toBe("42%3Arotated-session-value-xxxxxxx");
      expect(calls).toEqual(["accounts/current_user/"]);
    });

    it("uses IG_SESSION_ID when it differs from the saved session", async () => {
      await saveSession({ ...savedSession("alice"), authorization: { ds_user_id: "42", sessionid: "42%3Aold-session-value-xxxxxxxxxx" } });
      setConfig({ igpapi: { sessionId: SESSION_ID } });
      const { manager } = managerWith(currentUser("alice"));
      await manager.initialize();
      expect(manager.isLoggedIn()).toBe(true);
      expect((await loadSession())?.authorization?.sessionid).toBe(SESSION_ID);
    });
  });

  describe("loginWithSessionId", () => {
    it("verifies the cookie, records the account and saves the session", async () => {
      const { manager } = managerWith(currentUser("alice"));
      await manager.loginWithSessionId(`  ${SESSION_ID}  `);
      expect(manager.isLoggedIn()).toBe(true);
      expect(manager.getUsername()).toBe("alice");
      const saved = await loadSession();
      expect(saved?.authorization).toEqual({ ds_user_id: "42", sessionid: SESSION_ID, should_use_header_over_cookies: true });
      expect(saved?.username).toBe("alice");
    });

    it("rejects values that are not sessionid cookies before contacting Instagram", async () => {
      const { manager, calls } = managerWith(currentUser("alice"));
      await expect(manager.loginWithSessionId("not-a-cookie")).rejects.toThrow(/does not look like/);
      expect(calls).toEqual([]);
    });

    it("leaves no session behind when Instagram rejects the cookie", async () => {
      const { manager } = managerWith(() => json({ status: "fail", message: "login_required" }, 403));
      await expect(manager.loginWithSessionId(SESSION_ID)).rejects.toBeInstanceOf(IgLoginRequiredError);
      expect(manager.isLoggedIn()).toBe(false);
      expect(manager.getClient().hasSession).toBe(false);
      expect(await sessionExists()).toBe(false);
    });

    it("refuses a cookie for another account than IG_USERNAME", async () => {
      setConfig({ igpapi: { username: "alice" } });
      const { manager } = managerWith(currentUser("mallory"));
      await expect(manager.loginWithSessionId(SESSION_ID)).rejects.toThrow("belongs to @mallory");
      expect(manager.isLoggedIn()).toBe(false);
      expect(await sessionExists()).toBe(false);
    });

    it("names the previous failure when the login budget is used up", async () => {
      delete process.env.IG_RATE_LIMITS;
      resetRateLimiter();
      const { manager } = managerWith(() => json({ status: "fail", message: "Page not found" }, 404));
      await expect(manager.loginWithSessionId(SESSION_ID)).rejects.toThrow("HTTP 404");
      const second = manager.loginWithSessionId(SESSION_ID);
      await expect(second).rejects.toBeInstanceOf(RateLimitError);
      await expect(second).rejects.toThrow(/previous login attempt \(1s ago\) failed: accounts\/current_user\/ - HTTP 404/);
    });
  });

  describe("logout races", () => {
    function gated() {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { gate, release };
    }

    it("abandons a login that a logout overtook", async () => {
      const { gate, release } = gated();
      const { manager } = managerWith(async () => {
        await gate;
        return currentUser("alice")();
      });
      await manager.initialize();
      const inFlight = manager.loginWithSessionId(SESSION_ID);
      await manager.logout();
      release();

      await expect(inFlight).rejects.toThrow(LOGIN_CANCELLED_MESSAGE);
      expect(manager.isLoggedIn()).toBe(false);
      expect(manager.getUsername()).toBeNull();
      expect(await sessionExists()).toBe(false);
    });

    it("keeps a login made after logout when an older login finishes later", async () => {
      const { gate, release } = gated();
      let first = true;
      const { manager } = managerWith(async () => {
        if (first) {
          first = false;
          await gate;
        }
        return currentUser("alice")();
      });
      await manager.initialize();
      const stale = manager.loginWithSessionId(SESSION_ID);
      await manager.logout();
      await manager.loginWithSessionId(SESSION_ID);
      expect(manager.isLoggedIn()).toBe(true);

      release();
      await expect(stale).rejects.toThrow(LOGIN_CANCELLED_MESSAGE);
      expect(manager.isLoggedIn()).toBe(true);
      expect(await sessionExists()).toBe(true);
    });
  });

  it("explains that password login is unavailable and points to IG_SESSION_ID", async () => {
    const { manager, calls } = managerWith(() => json({}));
    await expect(manager.login("alice", "secret")).rejects.toThrow(PASSWORD_LOGIN_UNAVAILABLE_MESSAGE);
    expect(PASSWORD_LOGIN_UNAVAILABLE_MESSAGE).toContain("IG_SESSION_ID");
    expect(calls).toEqual([]);
  });

  it("getCurrentUser returns the raw user of the session", async () => {
    const { manager } = managerWith(currentUser("alice", 7));
    await manager.loginWithSessionId(SESSION_ID);
    await expect(manager.getCurrentUser()).resolves.toMatchObject({ pk: 7, username: "alice" });
  });
});
