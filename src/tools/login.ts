/**
 * instagram_login: signs in with the credentials from IG_USERNAME / IG_PASSWORD.
 *
 * When Instagram asks for a two-factor code and the client supports form
 * elicitation, the tool asks the user for the code directly (multi
 * round-trip on 2026-07-28, an `elicitation/create` request on 2025-era
 * connections via the SDK's legacy shim). Otherwise it returns instructions
 * to call instagram_complete_2fa.
 *
 * The password is never elicited: the spec forbids requesting passwords via
 * form elicitation, so it only comes from the environment.
 */

import { acceptedContent, inputRequired, inputResponse } from "@modelcontextprotocol/server";
import type { CallToolResult, InputRequiredResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getConfig } from "../config/index.js";
import { igpapiClient } from "../igpapi/index.js";
import type { TwoFactorAuthInfo } from "../types/index.js";
import { clientSupportsFormElicitation } from "./shared/elicitation.js";
import { toToolError, waitForStartup } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";

/** Key of the elicitation request inside `inputRequests` / `inputResponses`. */
const TWO_FACTOR_KEY = "twoFactorCode";

/** Schema sent to the client: only constraints form elicitation can express. */
const requestedSchema = z.object({
  code: z
    .string()
    .min(6)
    .max(9)
    .describe("6-digit code from SMS or your authenticator app (or an 8-digit backup code)"),
});

const TWO_FACTOR_CODE = /^\d{6,8}$/;

function isTwoFactorInfo(error: unknown): error is TwoFactorAuthInfo {
  return (
    typeof error === "object" &&
    error !== null &&
    "verificationMethod" in error &&
    "twoFactorIdentifier" in error
  );
}

function describeMethod(info: TwoFactorAuthInfo): string {
  return info.verificationMethod === "1"
    ? "Instagram sent a verification code by SMS."
    : "Open your authenticator app to get the verification code.";
}

function askForCode(info: TwoFactorAuthInfo, retryReason?: string): InputRequiredResult {
  const message = [
    retryReason,
    `Instagram requires two-factor authentication for @${info.username}.`,
    describeMethod(info),
    "Enter the code to finish signing in.",
  ]
    .filter(Boolean)
    .join(" ");
  return inputRequired({
    inputRequests: {
      [TWO_FACTOR_KEY]: inputRequired.elicit({ message, requestedSchema }),
    },
  });
}

function manualTwoFactorResult(info: TwoFactorAuthInfo, prefix?: string): CallToolResult {
  return textResult(
    [
      prefix,
      `Two-factor authentication is required for @${info.username}. ${describeMethod(info)}`,
      "Ask the user for the code, then call the instagram_complete_2fa tool with it as verification_code.",
    ]
      .filter(Boolean)
      .join("\n\n")
  );
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
        "Log in to Instagram with the credentials configured in the server environment (IG_USERNAME and IG_PASSWORD). " +
        "Takes no arguments; never ask the user for their password. If the account uses two-factor authentication, " +
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

      // Re-entry: the client answered our two-factor elicitation.
      const answer = inputResponse(ctx.mcpReq.inputResponses, TWO_FACTOR_KEY);
      if (answer.kind === "elicit") {
        const pending = igpapiClient.getTwoFactorInfo();
        if (!pending) {
          throw new Error("There is no pending two-factor login. Call instagram_login again to start over.");
        }
        if (answer.action !== "accept") {
          return manualTwoFactorResult(pending, "The user dismissed the code prompt. The login is still pending.");
        }
        const content = acceptedContent(
          ctx.mcpReq.inputResponses,
          TWO_FACTOR_KEY,
          z.object({ code: z.string() })
        );
        const code = content?.code.replace(/\s+/g, "") ?? "";
        if (!TWO_FACTOR_CODE.test(code)) {
          return askForCode(pending, "That code was not valid: it must be 6 to 8 digits.");
        }
        try {
          await igpapiClient.completeTwoFactorLogin(code);
        } catch (error) {
          throw new Error(
            `Instagram rejected the two-factor code (${toToolError(error).message}). Call instagram_login again to get a new code.`
          );
        }
        return loggedInSummary("Logged in to Instagram (two-factor authentication completed).");
      }

      const credentials = getConfig().igpapi;
      const username = credentials?.username;
      const password = credentials?.password;

      if (igpapiClient.isLoggedIn()) {
        try {
          return await loggedInSummary("Already logged in to Instagram.");
        } catch {
          // The saved session no longer works; fall through and log in again.
        }
      }

      // A login started at server startup (or by an earlier call) is already
      // waiting for a code. Logging in again would make Instagram send another SMS.
      const pending = igpapiClient.getTwoFactorInfo();
      if (pending) {
        return clientSupportsFormElicitation(server, ctx) ? askForCode(pending) : manualTwoFactorResult(pending);
      }

      if (!username || !password) {
        throw new Error(
          "Instagram credentials are not configured. Set the IG_USERNAME and IG_PASSWORD environment variables " +
            "in the MCP server configuration and restart the server."
        );
      }

      try {
        await igpapiClient.login(username, password);
      } catch (error) {
        if (isTwoFactorInfo(error)) {
          return clientSupportsFormElicitation(server, ctx)
            ? askForCode(error)
            : manualTwoFactorResult(error);
        }
        throw toToolError(error);
      }
      return loggedInSummary("Logged in to Instagram.");
    }
  );
}
