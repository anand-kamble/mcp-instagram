/**
 * instagram_complete_2fa: finishes a login that is waiting for a two-factor
 * code. Fallback for clients that cannot show an elicitation form.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { igpapiClient } from "../igpapi/index.js";
import { toToolError, waitForStartup } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";
import { closeTwoFactorPage } from "./shared/twoFactorPage.js";

export function registerCompleteTwoFactor(server: McpServer): void {
  server.registerTool(
    "instagram_complete_2fa",
    {
      title: "Complete two-factor login",
      description:
        "Finish an Instagram login that is waiting for a two-factor code. Call this only after instagram_login " +
        "said a code is required, with the code the user received by SMS or from their authenticator app.",
      inputSchema: z.object({
        verification_code: z
          .string()
          .regex(/^\s*\d[\d\s]{4,10}\d\s*$/, "verification_code must be the 6-8 digit code")
          .describe("The 6-digit code from SMS or the authenticator app (or an 8-digit backup code)"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ verification_code }) => {
      await waitForStartup();
      const pending = igpapiClient.getTwoFactorInfo();
      if (!pending) {
        throw new Error("There is no pending two-factor login. Call instagram_login first.");
      }
      const code = verification_code.replace(/\s+/g, "");
      if (!/^\d{6,8}$/.test(code)) {
        throw new Error("verification_code must be 6 to 8 digits.");
      }
      try {
        await igpapiClient.completeTwoFactorLogin(code);
      } catch (error) {
        throw new Error(
          `Instagram rejected the two-factor code (${toToolError(error).message}). Call instagram_login again to get a new code.`
        );
      }
      // The login is complete; the code page (if any) is no longer needed.
      closeTwoFactorPage();
      const user = await igpapiClient.getCurrentUser();
      return textResult(
        `Logged in to Instagram (two-factor authentication completed).\n\nAccount: @${user.username}\n` +
          `Full name: ${user.full_name || "N/A"}\nUser ID: ${user.pk}\n\n` +
          "The session is saved and will be reused when the server restarts."
      );
    }
  );
}
