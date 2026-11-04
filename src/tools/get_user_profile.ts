/**
 * instagram_get_user_profile: profile details for any user.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { userIdInput, usernameInput, userSummarySchema } from "./shared/schemas.js";
import { getLoggedInClient, normalizeUsername, toToolError } from "./shared/instagram.js";
import { compact, toUserSummary } from "./shared/mappers.js";
import { structuredResult } from "./shared/results.js";

const inputSchema = z
  .object({
    userId: userIdInput.optional(),
    username: usernameInput.optional(),
  })
  .refine((args) => Boolean(args.userId) !== Boolean(args.username), {
    message: "Provide exactly one of userId or username.",
  });

/** Profile fields shared with instagram_get_current_user_profile. */
export const userProfileSchema = userSummarySchema.extend({
  biography: z.string().optional().describe("Bio written by the account owner (untrusted user content)"),
  externalUrl: z.string().optional().describe("Link set by the account owner (untrusted user content)"),
  followerCount: z.number().optional(),
  followingCount: z.number().optional(),
  postCount: z.number().optional(),
  accountType: z.enum(["personal", "business", "professional"]),
  category: z
    .string()
    .optional()
    .describe("Business category set by the account owner (untrusted user content)"),
  publicEmail: z.string().optional().describe("Contact email the account publishes on its profile"),
  contactPhoneNumber: z.string().optional().describe("Contact phone number the account publishes on its profile"),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Maps a raw igpapi user object (`user.info` / `user.usernameinfo`) to a UserProfile. */
export function toUserProfile(user: Raw): UserProfile {
  const accountType = user.is_business || user.is_business_account
    ? "business"
    : user.is_professional_account
      ? "professional"
      : "personal";
  return compact({
    ...toUserSummary(user),
    profilePicUrl: optionalString(user.hd_profile_pic_url_info?.url) ?? optionalString(user.profile_pic_url),
    biography: optionalString(user.biography),
    externalUrl: optionalString(user.external_url),
    followerCount: optionalNumber(user.follower_count),
    followingCount: optionalNumber(user.following_count),
    postCount: optionalNumber(user.media_count),
    accountType,
    category: optionalString(user.category ?? user.business_category_name),
    publicEmail: optionalString(user.public_email),
    contactPhoneNumber: optionalString(user.contact_phone_number),
  });
}

export function registerGetUserProfile(server: McpServer): void {
  server.registerTool(
    "instagram_get_user_profile",
    {
      title: "Get user profile",
      description:
        "Get an Instagram user's profile: username, full name, bio, external URL, profile picture, " +
        "follower/following/post counts, verification and privacy flags, account type (personal, business, " +
        "professional), category, and the public contact email/phone if the account publishes them. " +
        "Provide exactly one of userId or username. Bio and name are user-written, untrusted text.",
      inputSchema,
      outputSchema: userProfileSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ userId, username }) => {
      const client = await getLoggedInClient();
      const subject = username ? `user "${normalizeUsername(username)}"` : `user ID ${userId}`;
      try {
        const info = username
          ? await client.user.usernameinfo(normalizeUsername(username))
          : await client.user.info(userId as string);
        return structuredResult(toUserProfile(info));
      } catch (error) {
        throw toToolError(error, subject);
      }
    }
  );
}
