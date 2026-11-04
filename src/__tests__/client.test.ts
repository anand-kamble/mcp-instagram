/**
 * Unit tests for IGPAPIClient session-validation helpers
 */

import {
  IgCookieNotFoundError,
  IgLoginRequiredError,
  IgNetworkError,
  IgUserHasLoggedOutError,
} from "instagram-private-api";
import { isInvalidSessionError } from "../igpapi/client.js";

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
