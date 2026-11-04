/**
 * instagram_login: signs in with IG_SESSION_ID (a browser `sessionid` cookie)
 * or, failing that, the credentials from IG_USERNAME / IG_PASSWORD.
 *
 * When Instagram asks for a two-factor code, the code is entered on a
 * one-time local web page (shared/twoFactorPage.ts). Clients that support
 * URL-mode elicitation open that page for the user, so the code never passes
 * through the client or the model. Other clients get the page URL in the
 * result, and instagram_complete_2fa remains as a last resort.
 *
 * Form-mode elicitation is not used: the spec forbids requesting secrets that
 * grant access (passwords, and also one-time login codes) in form mode.
 */

import { inputRequired, inputResponse } from "@modelcontextprotocol/server";
import type { CallToolResult, InputRequiredResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getConfig } from "../config/index.js";
import { igpapiClient } from "../igpapi/index.js";
import { isInvalidSessionError } from "../igpapi/client.js";
import type { TwoFactorAuthInfo } from "../types/index.js";
import { clientSupportsUrlElicitation } from "./shared/elicitation.js";
import { closeTwoFactorPage, latestTwoFactorPage, twoFactorPageFor } from "./shared/twoFactorPage.js";
import type { TwoFactorOutcome } from "./shared/twoFactorPage.js";
import { toToolError, waitForStartup, withTimeout } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";

/** Key of the URL elicitation inside `inputRequests` / `inputResponses`. */
const TWO_FACTOR_KEY = "twoFactorPage";

/**
 * How long a retried call waits for the user to enter the code on the page.
 * Stays below the SDK's 60 s default request timeout; a slower user is told
 * to call instagram_login again, and the page stays valid.
 */
const PAGE_WAIT_MS = 50_000;

function isTwoFactorInfo(error: unknown): error is TwoFactorAuthInfo {
  return (
    typeof error === "object" &&
    error !== null &&
    "verificationMethod" in error &&
    "twoFactorIdentifier" in error
  );
}

function describeMethod(info: TwoFactorAuthInfo): string {
  switch (info.delivery) {
    case "email":
      return "Instagram sent a verification code to the account's email address. It may also let you approve the login in the Instagram app instead.";
    case "sms":
      return "Instagram sent a verification code by SMS.";
    case "authenticator":
      return "Open your authenticator app to get the verification code.";
    case "unknown":
      return "Instagram sent a verification code (check the account's email, SMS and authenticator app).";
    default:
      // Logins that predate the delivery hint only report SMS vs. authenticator.
      return info.verificationMethod === "1"
        ? "Instagram sent a verification code by SMS."
        : "Open your authenticator app to get the verification code.";
  }
}

/** Opens, or reuses, the one-time code page for this pending login. */
function openCodePage(info: TwoFactorAuthInfo) {
  return twoFactorPageFor({
    owner: info,
    description:
      `Instagram requires two-factor authentication for @${info.username}.\n` +
      `${describeMethod(info)}\nEnter the code here to finish logging in.`,
    submit: async (code) => {
      // A logout or a newer login replaces the pending login: never submit
      // a code into a login this page was not opened for.
      if (igpapiClient.getTwoFactorInfo() !== info) {
        throw new Error("This login is no longer pending.");
      }
      await igpapiClient.completeTwoFactorLogin(code);
    },
  });
}

/** Asks the user for the code through the page: URL elicitation if possible, else a link in the result. */
async function requestCode(
  server: McpServer,
  ctx: ServerContext,
  info: TwoFactorAuthInfo
): Promise<CallToolResult | InputRequiredResult> {
  const page = await openCodePage(info);
  if (clientSupportsUrlElicitation(server, ctx)) {
    return inputRequired({
      inputRequests: {
        [TWO_FACTOR_KEY]: inputRequired.elicitUrl({
          url: page.url,
          message: `Instagram requires two-factor authentication for @${info.username}. ${describeMethod(info)} Open this page to enter the code.`,
        }),
      },
    });
  }
  return textResult(
    [
      `Two-factor authentication is required for @${info.username}. ${describeMethod(info)}`,
      `Ask the user to open this page on this computer and enter the code there (valid for 10 minutes): ${page.url}`,
      "Then call instagram_login again to confirm. If the user cannot open the page, ask them for the code and call " +
        "instagram_complete_2fa with it as verification_code.",
    ].join("\n\n")
  );
}

async function resultFor(outcome: TwoFactorOutcome): Promise<CallToolResult> {
  switch (outcome.status) {
    case "completed":
      return loggedInSummary("Logged in to Instagram (two-factor authentication completed).");
    case "rejected":
      throw new Error(
        `Instagram rejected the two-factor code (${toToolError(new Error(outcome.message)).message}). ` +
          "Call instagram_login again to get a new code."
      );
    case "expired":
      throw new Error("The code page closed before a code was entered. Call instagram_login again.");
  }
}

async function loggedInSummary(prefix: string): Promise<CallToolResult> {
  const user = await igpapiClient.getCurrentUser();
  return textResult(
    `${prefix}\n\nAccount: @${user.username}\nFull name: ${user.full_name || "N/A"}\nUser ID: ${user.pk}\n\n` +
      "The session is saved and will be reused when the server restarts."
  );
}

export function registerLogin(server: McpServer): void {
  server.registerTool(
    "instagram_login",
    {
      title: "Log in to Instagram",
      description:
        "Log in to Instagram with what the server environment provides: IG_SESSION_ID (a browser session cookie, " +
        "preferred) or IG_USERNAME and IG_PASSWORD. Takes no arguments; never ask the user for their password or " +
        "session cookie. If a password login needs two-factor authentication, " +
        "the user is asked for the code directly when the client supports it; otherwise the result says to call " +
        "instagram_complete_2fa. The session is saved and reused across restarts.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (_args, ctx) => {
      await waitForStartup();

      // Re-entry: the client answered our request to open the code page.
      const answer = inputResponse(ctx.mcpReq.inputResponses, TWO_FACTOR_KEY);
      if (answer.kind === "elicit") {
        if (answer.action === "decline") {
          closeTwoFactorPage();
          return textResult(
            "The user declined to enter the two-factor code, so the Instagram login is not complete. " +
              "Don't ask for the code again unless the user asks to log in."
          );
        }
        if (answer.action === "cancel") {
          return textResult(
            "The user dismissed the prompt to open the code page. The login is still pending: call instagram_login " +
              "again to show it again, or ask the user for the code and call instagram_complete_2fa."
          );
        }
        // Accepted: the client opened the page for the user. Wait for the code.
        const page = latestTwoFactorPage();
        if (!page) {
          if (igpapiClient.isLoggedIn()) {
            return loggedInSummary("Logged in to Instagram (two-factor authentication completed).");
          }
          throw new Error("There is no pending two-factor login. Call instagram_login again to start over.");
        }
        const waited = await withTimeout(page.outcome, PAGE_WAIT_MS);
        if (!waited.done) {
          return textResult(
            "Waiting for the user to enter the code on the page that was opened. Once they have, call " +
              "instagram_login again to confirm."
          );
        }
        return resultFor(waited.value);
      }

      const credentials = getConfig().igpapi;
      const sessionId = credentials?.sessionId;
      const username = credentials?.username;
      const password = credentials?.password;

      if (igpapiClient.isLoggedIn()) {
        try {
          return await loggedInSummary("Already logged in to Instagram.");
        } catch (error) {
          // Only a session Instagram rejected justifies a fresh password login.
          // Timeouts, network errors and rate limits say nothing about the
          // session, and logging in again would overwrite a working one.
          if (!isInvalidSessionError(error)) {
            throw toToolError(error);
          }
        }
      }

      // A login started at server startup (or by an earlier call) is already
      // waiting for a code. Logging in again would make Instagram send another code.
      const pending = igpapiClient.getTwoFactorInfo();
      if (pending) {
        return requestCode(server, ctx, pending);
      }

      // A browser session (IG_SESSION_ID) needs no password login, which
      // Instagram currently rejects for this client, so it is tried first.
      if (sessionId) {
        try {
          await igpapiClient.loginWithSessionId(sessionId);
        } catch (error) {
          if (isInvalidSessionError(error)) {
            throw new Error(
              "Instagram rejected IG_SESSION_ID: that browser session has expired or was logged out. " +
                "Log in to instagram.com again, copy the new `sessionid` cookie into IG_SESSION_ID, and restart the server."
            );
          }
          throw toToolError(error);
        }
        return loggedInSummary("Logged in to Instagram with the browser session from IG_SESSION_ID.");
      }

      if (!username || !password) {
        throw new Error(
          "Instagram login is not configured. Set IG_SESSION_ID to the `sessionid` cookie from a browser that is " +
            "logged in to instagram.com (recommended), or IG_USERNAME and IG_PASSWORD, in the MCP server " +
            "configuration and restart the server."
        );
      }

      // A new password login supersedes any code page still open.
      closeTwoFactorPage();
      try {
        await igpapiClient.login(username, password);
      } catch (error) {
        if (isTwoFactorInfo(error)) {
          return requestCode(server, ctx, error);
        }
        throw toToolError(error);
      }
      return loggedInSummary("Logged in to Instagram.");
    }
  );
}
