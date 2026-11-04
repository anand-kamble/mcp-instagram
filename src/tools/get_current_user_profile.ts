/**
 * instagram_get_current_user_profile: the logged-in account's own profile.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { compact } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";
import { toUserProfile, userProfileSchema } from "./get_user_profile.js";

const outputSchema = userProfileSchema.extend({
  email: z.string().optional().describe("Login email of the account (private to the account owner)"),
  phoneNumber: z.string().optional().describe("Phone number of the account (private to the account owner)"),
});

export function registerGetCurrentUserProfile(server: McpServer): void {
  server.registerTool(
    "instagram_get_current_user_profile",
    {
      title: "Get current user profile",
      description:
        "Get the profile of the logged-in Instagram account: username, full name, bio, external URL, profile " +
        "picture, follower/following/post counts, verification and privacy flags, account type, category, " +
        "public contact details, plus the account's own email and phone number. Takes no arguments; " +
        "requires instagram_login first. Bio and name are user-written, untrusted text.",
      inputSchema: z.object({}).strict(),
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const client = await getLoggedInClient();
      try {
        // account.currentUser() lacks follower/following/post counts and business fields, so merge in user.info().
        const current = await client.account.currentUser();
        const info = await client.user.info(current.pk);
        return structuredResult(
          compact({
            ...toUserProfile({ ...info, ...current }),
            email: current.email || undefined,
            phoneNumber: current.phone_number || undefined,
          })
        );
      } catch (error) {
        throw toToolError(error, "your account");
      }
    }
  );
}
