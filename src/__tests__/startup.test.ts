/**
 * Tool calls wait for startup session restore, but not forever.
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { igpapiClient } from "../igpapi/index.js";
import {
  STARTUP_WAIT_MS,
  pendingStartup,
  setStartupPromise,
  waitForStartup,
  withTimeout,
} from "../tools/shared/instagram.js";
import { call, connect } from "./helpers.js";

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("withTimeout", () => {
  it("returns the value when the promise settles first", async () => {
    await expect(withTimeout(Promise.resolve(5), 1_000)).resolves.toEqual({ done: true, value: 5 });
  });

  it("propagates rejections", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1_000)).rejects.toThrow("boom");
  });
});

describe("waitForStartup", () => {
  it("waits for a startup that finishes", async () => {
    let finished = false;
    setStartupPromise(new Promise<void>((resolve) => setTimeout(() => ((finished = true), resolve()), 10)));
    await waitForStartup();
    expect(finished).toBe(true);
  });

  it("stops waiting for a startup that hangs, and does not wait again", async () => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    setStartupPromise(new Promise(() => undefined));

    const first = waitForStartup();
    await jest.advanceTimersByTimeAsync(STARTUP_WAIT_MS);
    await expect(first).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("did not finish"));

    // A later call returns immediately instead of waiting another 35 seconds.
    await expect(waitForStartup()).resolves.toBeUndefined();
  });
});

describe("logout during a stalled startup", () => {
  it("undoes a background login that finishes after the logout", async () => {
    let loggedIn = false;
    jest.spyOn(igpapiClient, "isLoggedIn").mockImplementation(() => loggedIn);
    jest.spyOn(igpapiClient, "getUsername").mockReturnValue(null);
    jest.spyOn(igpapiClient, "getClient").mockReturnValue({ account: { logout: async () => ({}) } } as never);
    const logout = jest.spyOn(igpapiClient, "logout").mockImplementation(async () => {
      loggedIn = false;
    });

    let finishStartup: () => void = () => undefined;
    setStartupPromise(new Promise<void>((resolve) => (finishStartup = resolve)));
    // Simulate tools having given up waiting on the stalled startup.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.useFakeTimers();
    const waited = waitForStartup();
    await jest.advanceTimersByTimeAsync(STARTUP_WAIT_MS);
    await waited;
    jest.useRealTimers();

    const connection = await connect("modern");
    try {
      await call(connection, "instagram_logout");
      expect(logout).toHaveBeenCalledTimes(1);

      // The background auto-login now completes and logs the account back in.
      loggedIn = true;
      finishStartup();
      await pendingStartup()?.catch(() => undefined);
      await new Promise((resolve) => setImmediate(resolve));

      expect(logout).toHaveBeenCalledTimes(2);
      expect(loggedIn).toBe(false);
      expect(pendingStartup()).toBeUndefined();
    } finally {
      await connection.close();
    }
  });
});
