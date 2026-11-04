/**
 * Tool calls wait for startup session restore, but not forever.
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { STARTUP_WAIT_MS, setStartupPromise, waitForStartup, withTimeout } from "../tools/shared/instagram.js";

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
