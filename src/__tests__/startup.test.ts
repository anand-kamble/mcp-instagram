/**
 * Tool calls wait for startup session restore, but not forever.
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { igpapiClient } from "../igpapi/index.js";
import { STARTUP_WAIT_MS, setStartupPromise, waitForStartup, withTimeout } from "../tools/shared/instagram.js";
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
  // Discarding the stale startup login itself is IGPAPIClient's job (auth
  // epoch, see client.test.ts). This checks the tool layer adds nothing that
  // acts later: a login made after the logout survives the startup settling.
  it("leaves a login made after the logout alone when the stalled startup settles", async () => {
    let loggedIn = true;
    jest.spyOn(igpapiClient, "isLoggedIn").mockImplementation(() => loggedIn);
    jest.spyOn(igpapiClient, "getUsername").mockReturnValue(null);
    jest.spyOn(igpapiClient, "getClient").mockReturnValue({ request: async () => ({}) } as never);
    const logout = jest.spyOn(igpapiClient, "logout").mockImplementation(async () => {
      loggedIn = false;
    });

    let finishStartup: () => void = () => undefined;
    const stalled = new Promise<void>((resolve) => (finishStartup = resolve));
    setStartupPromise(stalled);
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

      // The user logs in again, then the stalled startup finally settles.
      loggedIn = true;
      finishStartup();
      await stalled;
      await new Promise((resolve) => setImmediate(resolve));

      expect(logout).toHaveBeenCalledTimes(1);
      expect(loggedIn).toBe(true);
    } finally {
      await connection.close();
    }
  });
});
