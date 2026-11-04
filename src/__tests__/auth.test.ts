/**
 * instagram_login / instagram_complete_2fa / instagram_logout, including the
 * two-factor code page (URL elicitation) on both protocol eras.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Client } from "@modelcontextprotocol/client";
import { PASSWORD_LOGIN_UNAVAILABLE_MESSAGE } from "../igpapi/client.js";
import { IgLoginRequiredError, IgRateLimitedError } from "../instagram/errors.js";
import { setConfig } from "../config/index.js";
import { igpapiClient } from "../igpapi/index.js";
import type { TwoFactorAuthInfo } from "../types/index.js";
import { call, connect, ERAS, textOf } from "./helpers.js";
import type { Connection } from "./helpers.js";

const TWO_FACTOR: TwoFactorAuthInfo = {
  username: "alice",
  twoFactorIdentifier: "identifier-1",
  verificationMethod: "1",
  totpTwoFactorOn: false,
};

interface FakeAccount {
  loggedIn: boolean;
  pending: TwoFactorAuthInfo | null;
  requiresTwoFactor: boolean;
  /** Instagram-side logout call; replace to simulate failures. */
  revoke: jest.Mock<() => Promise<unknown>>;
}

/** Wires the singleton to an in-memory account whose login may require 2FA (valid code: 123456). */
function fakeAccount(initial: Partial<FakeAccount> = {}): FakeAccount {
  const state: FakeAccount = {
    loggedIn: false,
    pending: null,
    requiresTwoFactor: false,
    revoke: jest.fn(async () => ({ status: "ok" })),
    ...initial,
  };
  jest.spyOn(igpapiClient, "isInitialized").mockReturnValue(true);
  jest.spyOn(igpapiClient, "initialize").mockResolvedValue(undefined);
  jest.spyOn(igpapiClient, "isLoggedIn").mockImplementation(() => state.loggedIn);
  jest.spyOn(igpapiClient, "getTwoFactorInfo").mockImplementation(() => state.pending);
  jest.spyOn(igpapiClient, "hasPendingTwoFactor").mockImplementation(() => state.pending !== null);
  jest.spyOn(igpapiClient, "login").mockImplementation(async () => {
    if (state.requiresTwoFactor) {
      state.pending = TWO_FACTOR;
      throw TWO_FACTOR;
    }
    state.loggedIn = true;
  });
  jest.spyOn(igpapiClient, "completeTwoFactorLogin").mockImplementation(async (code: string) => {
    const valid = state.pending !== null && code === "123456";
    state.pending = null;
    if (!valid) {
      throw new Error("Invalid verification code");
    }
    state.loggedIn = true;
  });
  jest
    .spyOn(igpapiClient, "getCurrentUser")
    .mockImplementation(async () => ({ username: "alice", full_name: "Alice Example", pk: 42 }) as never);
  jest.spyOn(igpapiClient, "getUsername").mockImplementation(() => (state.loggedIn ? "alice" : null));
  jest.spyOn(igpapiClient, "getClient").mockImplementation(
    () =>
      ({
        request: async (req: { path: string }) => (req.path === "accounts/logout/" ? state.revoke() : {}),
      }) as never
  );
  jest.spyOn(igpapiClient, "loginWithSessionId").mockImplementation(async (sessionid: string) => {
    if (sessionid !== "1000%3Avalid%3A1") {
      throw new IgLoginRequiredError({ status: 403, path: "users/1000/info/", body: { message: "login_required" } });
    }
    state.loggedIn = true;
  });
  jest.spyOn(igpapiClient, "logout").mockImplementation(async () => {
    state.loggedIn = false;
    state.pending = null;
  });
  return state;
}

/** What the simulated user does with a URL elicitation, before answering it. */
type PageAction =
  | { action: "accept"; codes?: string[]; delayMs?: number }
  | { action: "decline" | "cancel" };

interface SeenUrlElicitation {
  mode?: string;
  url: string;
  message: string;
}

/** Posts a code to the page the way the browser form does. */
async function postCode(url: string, code: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code }).toString(),
  });
}

/**
 * Registers an elicitation handler that plays the user: for "accept" it opens
 * the page and types each code (immediately, or after `delayMs` while the
 * tool is already waiting), then answers the elicitation.
 */
function answerUrlElicitations(actions: PageAction[], seen: SeenUrlElicitation[], pageStatuses: number[] = []) {
  return (client: Client) => {
    client.setRequestHandler("elicitation/create", async (request) => {
      const params = request.params as unknown as SeenUrlElicitation;
      seen.push(params);
      const next = actions.shift() ?? { action: "cancel" as const };
      if (next.action === "accept") {
        const type = async () => {
          pageStatuses.push((await fetch(params.url)).status);
          for (const code of next.codes ?? []) pageStatuses.push((await postCode(params.url, code)).status);
        };
        if (next.delayMs) setTimeout(() => void type(), next.delayMs);
        else await type();
        return { action: "accept" as const };
      }
      return { action: next.action };
    });
  };
}

const URL_ELICITATION = { elicitation: { url: {} } };

beforeEach(() => {
  setConfig({ igpapi: { sessionId: undefined, username: "alice", password: "secret-password" } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ERAS)("instagram_login on the %s era", (era) => {
  let connection: Connection | undefined;

  afterEach(async () => {
    await connection?.close();
    connection = undefined;
  });

  it("logs in without 2FA", async () => {
    const account = fakeAccount();
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("@alice");
    expect(account.loggedIn).toBe(true);
  });

  it("reports an existing session without logging in again", async () => {
    fakeAccount({ loggedIn: true });
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(textOf(result)).toContain("Already logged in");
    expect(igpapiClient.login).not.toHaveBeenCalled();
  });

  it("keeps a saved session it cannot verify right now instead of logging in again", async () => {
    fakeAccount({ loggedIn: true });
    jest
      .spyOn(igpapiClient, "getCurrentUser")
      .mockRejectedValue(new IgRateLimitedError({ status: 429, path: "accounts/current_user/", body: {} }));
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("rate limit");
    expect(igpapiClient.login).not.toHaveBeenCalled();
  });

  it("logs in again when Instagram rejects the saved session", async () => {
    const account = fakeAccount({ loggedIn: true });
    jest
      .spyOn(igpapiClient, "getCurrentUser")
      .mockRejectedValueOnce(
        new IgLoginRequiredError({ status: 403, path: "accounts/current_user/", body: { message: "login_required" } })
      );
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(igpapiClient.login).toHaveBeenCalledTimes(1);
    expect(account.loggedIn).toBe(true);
  });

  it("fails clearly when no login method is configured", async () => {
    fakeAccount();
    setConfig({ igpapi: { username: undefined, password: undefined } });
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("IG_SESSION_ID");
    expect(textOf(result)).toContain("IG_USERNAME");
  });

  it("logs in with IG_SESSION_ID before trying a password login", async () => {
    const account = fakeAccount();
    setConfig({ igpapi: { sessionId: "1000%3Avalid%3A1", username: "alice", password: "secret-password" } });
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("IG_SESSION_ID");
    expect(igpapiClient.loginWithSessionId).toHaveBeenCalledWith("1000%3Avalid%3A1");
    expect(igpapiClient.login).not.toHaveBeenCalled();
    expect(account.loggedIn).toBe(true);
  });

  it("explains how to refresh an IG_SESSION_ID that Instagram rejects", async () => {
    fakeAccount();
    setConfig({ igpapi: { sessionId: "1000%3Aexpired%3A1" } });
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Instagram rejected IG_SESSION_ID");
  });

  it("surfaces why password login is unavailable", async () => {
    fakeAccount();
    jest.spyOn(igpapiClient, "login").mockRejectedValue(new Error(PASSWORD_LOGIN_UNAVAILABLE_MESSAGE));
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("IG_SESSION_ID");
  });

  it("opens the one-time code page through URL elicitation and completes the login", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    const seen: SeenUrlElicitation[] = [];
    const statuses: number[] = [];
    connection = await connect(
      era,
      URL_ELICITATION,
      answerUrlElicitations([{ action: "accept", codes: ["123 456"] }], seen, statuses)
    );
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("two-factor authentication completed");
    expect(account.loggedIn).toBe(true);
    expect(igpapiClient.completeTwoFactorLogin).toHaveBeenCalledWith("123456");
    expect(igpapiClient.login).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([200, 200]);

    expect(seen).toHaveLength(1);
    expect(seen[0].mode).toBe("url");
    expect(seen[0].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/2fa\/[A-Za-z0-9_-]{43}$/);
    expect(seen[0].message).toContain("SMS");
    expect(JSON.stringify(seen)).not.toContain("secret-password");
  });

  it("says where Instagram sent the code when the login reports it", async () => {
    fakeAccount({ requiresTwoFactor: true });
    TWO_FACTOR.delivery = "email";
    const seen: SeenUrlElicitation[] = [];
    try {
      connection = await connect(era, URL_ELICITATION, answerUrlElicitations([{ action: "cancel" }], seen));
      await call(connection, "instagram_login");
    } finally {
      delete TWO_FACTOR.delivery;
    }
    expect(seen[0].message).toContain("email address");
  });

  it("never asks for the code with a form", async () => {
    fakeAccount({ requiresTwoFactor: true });
    const seen: SeenUrlElicitation[] = [];
    connection = await connect(
      era,
      { elicitation: { form: {}, url: {} } },
      answerUrlElicitations([{ action: "cancel" }], seen)
    );
    await call(connection, "instagram_login");
    expect(seen.every((request) => request.mode === "url")).toBe(true);
  });

  it("keeps the page usable after a malformed code", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    const statuses: number[] = [];
    connection = await connect(
      era,
      URL_ELICITATION,
      answerUrlElicitations([{ action: "accept", codes: ["12ab", "123456"] }], [], statuses)
    );
    const result = await call(connection, "instagram_login");
    expect(statuses).toEqual([200, 400, 200]);
    expect(account.loggedIn).toBe(true);
    expect(result.isError).toBeFalsy();
  });

  it("waits for a code typed after the page was opened", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    connection = await connect(
      era,
      URL_ELICITATION,
      answerUrlElicitations([{ action: "accept", codes: ["123456"], delayMs: 100 }], [])
    );
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(account.loggedIn).toBe(true);
  });

  it("returns an error when Instagram rejects the code, and closes the page", async () => {
    fakeAccount({ requiresTwoFactor: true });
    const seen: SeenUrlElicitation[] = [];
    connection = await connect(
      era,
      URL_ELICITATION,
      answerUrlElicitations([{ action: "accept", codes: ["999999"] }], seen)
    );
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("instagram_login again");
    await expect(fetch(seen[0].url)).rejects.toThrow();
  });

  it("leaves the login pending and points to instagram_complete_2fa when the prompt is dismissed", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era, URL_ELICITATION, answerUrlElicitations([{ action: "cancel" }], []));
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("instagram_complete_2fa");
    expect(account.pending).not.toBeNull();
  });

  it("tells the model not to push when the user declines", async () => {
    fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era, URL_ELICITATION, answerUrlElicitations([{ action: "decline" }], []));
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("declined");
    expect(textOf(result)).not.toContain("instagram_complete_2fa");
  });

  it("gives clients without URL elicitation the page link and the instagram_complete_2fa fallback", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era, { elicitation: { form: {} } });
    const login = await call(connection, "instagram_login");
    expect(login.isError).toBeFalsy();
    const link = textOf(login).match(/http:\/\/127\.0\.0\.1:\d+\/2fa\/\S+/)?.[0];
    expect(link).toBeDefined();
    expect(textOf(login)).toContain("instagram_complete_2fa");

    // The user enters the code on the page; the next instagram_login confirms.
    expect((await postCode(link as string, "123456")).status).toBe(200);
    expect(account.loggedIn).toBe(true);
    const confirm = await call(connection, "instagram_login");
    expect(textOf(confirm)).toContain("Already logged in");
  });

  it("lets instagram_complete_2fa finish the login instead of the page", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era);
    const login = await call(connection, "instagram_login");
    const link = textOf(login).match(/http:\/\/127\.0\.0\.1:\d+\/2fa\/\S+/)?.[0] as string;
    const complete = await call(connection, "instagram_complete_2fa", { verification_code: "123456" });
    expect(complete.isError).toBeFalsy();
    expect(account.loggedIn).toBe(true);
    // The page closed with the login.
    await expect(fetch(link)).rejects.toThrow();
  });

  it("does not trigger a second login while a 2FA code is already pending", async () => {
    fakeAccount({ requiresTwoFactor: true, pending: TWO_FACTOR });
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(textOf(result)).toContain("instagram_complete_2fa");
    expect(igpapiClient.login).not.toHaveBeenCalled();
  });
});

describe.each(ERAS)("instagram_complete_2fa and instagram_logout on the %s era", (era) => {
  let connection: Connection;

  beforeEach(async () => {
    connection = await connect(era);
  });

  afterEach(async () => {
    await connection.close();
  });

  it("refuses to complete 2FA when nothing is pending", async () => {
    fakeAccount();
    const result = await call(connection, "instagram_complete_2fa", { verification_code: "123456" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no pending");
  });

  it("rejects a malformed code before contacting Instagram", async () => {
    fakeAccount({ pending: TWO_FACTOR });
    const result = await call(connection, "instagram_complete_2fa", { verification_code: "12ab" });
    expect(result.isError).toBe(true);
    expect(igpapiClient.completeTwoFactorLogin).not.toHaveBeenCalled();
  });

  it("ends the session on Instagram, then deletes it locally", async () => {
    const account = fakeAccount({ loggedIn: true });
    const result = await call(connection, "instagram_logout");
    expect(account.revoke).toHaveBeenCalledTimes(1);
    expect(igpapiClient.logout).toHaveBeenCalledTimes(1);
    expect(textOf(result)).toContain("@alice");
    expect(textOf(result)).toContain("ended on Instagram");
    expect(account.loggedIn).toBe(false);
  });

  it("warns that logging out also ends the browser session behind IG_SESSION_ID", async () => {
    fakeAccount({ loggedIn: true });
    setConfig({ igpapi: { sessionId: "1000%3Avalid%3A1" } });
    const result = await call(connection, "instagram_logout");
    expect(textOf(result)).toContain("also logged out the browser session");
  });

  it("still deletes the local session when Instagram cannot be reached", async () => {
    const account = fakeAccount({ loggedIn: true, revoke: jest.fn(async () => Promise.reject(new Error("offline"))) });
    const result = await call(connection, "instagram_logout");
    expect(result.isError).toBeFalsy();
    expect(igpapiClient.logout).toHaveBeenCalledTimes(1);
    expect(textOf(result)).toContain("could not be reached");
    expect(account.loggedIn).toBe(false);
  });

  it("clears leftover local state even without an active session", async () => {
    const account = fakeAccount({ pending: TWO_FACTOR });
    const result = await call(connection, "instagram_logout");
    expect(account.revoke).not.toHaveBeenCalled();
    expect(igpapiClient.logout).toHaveBeenCalledTimes(1);
    expect(account.pending).toBeNull();
    expect(textOf(result)).toContain("no active Instagram session");
  });
});
