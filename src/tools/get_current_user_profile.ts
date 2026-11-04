/**
 * instagram_get_current_user_profile: the logged-in account's own profile.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { getLoggedInClient, toToolError } from "./shared/instagram.js";
import { structuredResult } from "./shared/results.js";
import { toUserProfile, userProfileSchema } from "./get_user_profile.js";

/**
 * Same shape as instagram_get_user_profile. The account's private login email
 * and phone number are deliberately left out: tool results share the model's
 * context with untrusted captions and comments, and a prompt injection could
 * ask the model to post them publicly.
 */
const outputSchema = userProfileSchema;

export function registerGetCurrentUserProfile(server: McpServer): void {
  server.registerTool(
    "instagram_get_current_user_profile",
    {
      title: "Get current user profile",
      description:
        "Get the profile of the logged-in Instagram account: username, full name, bio, external URL, profile " +
        "picture, follower/following/post counts, verification and privacy flags, account type, category, " +
        "public contact details (the private login email and phone are not returned). Takes no arguments; " +
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
        return structuredResult(toUserProfile({ ...info, ...current }));
      } catch (error) {
        throw toToolError(error, "your account");
      }
    }
  );
}
