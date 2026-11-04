/**
 * Tool registry.
 *
 * Registration order is the order clients see in tools/list. Keep it static:
 * the 2026-07-28 spec asks servers to list tools in a deterministic order so
 * clients can cache prompts.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { registerLogin } from "./login.js";
import { registerCompleteTwoFactor } from "./complete_2fa.js";
import { registerSearchAccounts } from "./search_accounts.js";
import { registerLogout } from "./logout.js";
import { registerGetUserProfile } from "./get_user_profile.js";
import { registerGetCurrentUserProfile } from "./get_current_user_profile.js";
import { registerGetUserPosts } from "./get_user_posts.js";
import { registerLikePost } from "./like_post.js";
import { registerLikeComment } from "./like_comment.js";
import { registerCommentOnPost } from "./comment_on_post.js";
import { registerGetPostComments } from "./get_post_comments.js";
import { registerGetPostDetails } from "./get_post_details.js";
import { registerGetUserStories } from "./get_user_stories.js";
import { registerGetTimelineFeed } from "./get_timeline_feed.js";
import { registerFollowUser } from "./follow_user.js";

const registrations: Array<(server: McpServer) => void> = [
  registerLogin,
  registerCompleteTwoFactor,
  registerSearchAccounts,
  registerLogout,
  registerGetUserProfile,
  registerGetCurrentUserProfile,
  registerGetUserPosts,
  registerLikePost,
  registerLikeComment,
  registerCommentOnPost,
  registerGetPostComments,
  registerGetPostDetails,
  registerGetUserStories,
  registerGetTimelineFeed,
  registerFollowUser,
];

export function registerTools(server: McpServer): void {
  for (const register of registrations) {
    register(server);
  }
}
