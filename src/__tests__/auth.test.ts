/**
 * instagram_login / instagram_complete_2fa / instagram_logout, including the
 * two-factor elicitation flow on both protocol eras.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Client } from "@modelcontextprotocol/client";
import { IgLoginRequiredError, IgResponseError } from "instagram-private-api";
import { setConfig } from "../config/index.js";
import { igpapiClient } from "../igpapi/index.js";
import type { TwoFactorAuthInfo } from "../types/index.js";
import { call, connect, ERAS, fakeResponse, textOf } from "./helpers.js";
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
  jest
    .spyOn(igpapiClient, "getClient")
    .mockImplementation(() => ({ account: { logout: () => state.revoke() } }) as never);
  jest.spyOn(igpapiClient, "logout").mockImplementation(async () => {
    state.loggedIn = false;
    state.pending = null;
  });
  return state;
}

type ElicitAnswer = { action: "accept"; content: Record<string, unknown> } | { action: "decline" | "cancel" };

/** Registers an elicitation handler that replays `answers` in order and records each request. */
function answerElicitations(answers: ElicitAnswer[], seen: unknown[]) {
  return (client: Client) => {
    client.setRequestHandler("elicitation/create", async (request) => {
      seen.push(request.params);
      return answers.shift() ?? { action: "cancel" };
    });
  };
}

const ELICITATION = { elicitation: { form: {} } };

beforeEach(() => {
  setConfig({ igpapi: { username: "alice", password: "secret-password" } });
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
    jest.spyOn(igpapiClient, "getCurrentUser").mockRejectedValue(new IgResponseError(fakeResponse(429)));
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
      .mockRejectedValueOnce(new IgLoginRequiredError(fakeResponse(403, { message: "login_required" })));
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(igpapiClient.login).toHaveBeenCalledTimes(1);
    expect(account.loggedIn).toBe(true);
  });

  it("fails clearly when credentials are not configured", async () => {
    fakeAccount();
    setConfig({ igpapi: { username: undefined, password: undefined } });
    connection = await connect(era);
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("IG_USERNAME");
  });

  it("asks for the 2FA code through elicitation and completes the login", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    const seen: unknown[] = [];
    connection = await connect(
      era,
      ELICITATION,
      answerElicitations([{ action: "accept", content: { code: "123 456" } }], seen)
    );
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("two-factor authentication completed");
    expect(account.loggedIn).toBe(true);
    expect(igpapiClient.completeTwoFactorLogin).toHaveBeenCalledWith("123456");
    expect(igpapiClient.login).toHaveBeenCalledTimes(1);

    expect(seen).toHaveLength(1);
    const request = seen[0] as { message: string; requestedSchema: { properties: Record<string, unknown> } };
    expect(Object.keys(request.requestedSchema.properties)).toEqual(["code"]);
    expect(request.message).toContain("SMS");
    expect(JSON.stringify(request)).not.toContain("secret-password");
  });

  it("asks again when the code is malformed", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    const seen: unknown[] = [];
    connection = await connect(
      era,
      ELICITATION,
      answerElicitations(
        [
          { action: "accept", content: { code: "abcdefg" } },
          { action: "accept", content: { code: "123456" } },
        ],
        seen
      )
    );
    const result = await call(connection, "instagram_login");
    expect(account.loggedIn).toBe(true);
    expect(seen).toHaveLength(2);
    expect((seen[1] as { message: string }).message).toContain("not valid");
    expect(result.isError).toBeFalsy();
  });

  it("leaves the login pending and points to instagram_complete_2fa when the prompt is dismissed", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era, ELICITATION, answerElicitations([{ action: "cancel" }], []));
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("instagram_complete_2fa");
    expect(account.pending).not.toBeNull();
  });

  it("tells the model not to push when the user declines to enter the code", async () => {
    fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era, ELICITATION, answerElicitations([{ action: "decline" }], []));
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("declined");
    expect(textOf(result)).not.toContain("instagram_complete_2fa");
  });

  it("returns an error when Instagram rejects the elicited code", async () => {
    fakeAccount({ requiresTwoFactor: true });
    connection = await connect(
      era,
      ELICITATION,
      answerElicitations([{ action: "accept", content: { code: "999999" } }], [])
    );
    const result = await call(connection, "instagram_login");
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("instagram_login again");
  });

  it("falls back to instagram_complete_2fa when the client cannot show forms", async () => {
    const account = fakeAccount({ requiresTwoFactor: true });
    connection = await connect(era);
    const login = await call(connection, "instagram_login");
    expect(login.isError).toBeFalsy();
    expect(textOf(login)).toContain("instagram_complete_2fa");
    expect(account.pending).not.toBeNull();

    const complete = await call(connection, "instagram_complete_2fa", { verification_code: "123456" });
    expect(complete.isError).toBeFalsy();
    expect(account.loggedIn).toBe(true);
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
