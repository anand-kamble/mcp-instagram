# Instagram MCP Tools Implementation Plan

> **Status**: 3 of 116 tools implemented (2.6%) | Last updated: 2024

## Quick Links

- [Getting Started for Contributors](#getting-started-for-contributors)
- [Implementation Status](#implementation-status)
- [Tool Priority List](#tool-priority-list)
- [Contribution Guidelines](#contribution-guidelines)
- [Implementation Notes](#implementation-notes)

---

## Getting Started for Contributors

### Prerequisites
- Node.js and npm installed
- Understanding of TypeScript
- Familiarity with the MCP (Model Context Protocol) protocol
- Basic knowledge of Instagram API operations

### Setup Development Environment
1. Clone the repository:
   ```bash
   git clone https://github.com/anand-kamble/mcp-instagram.git
   cd mcp-instagram
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Review existing implementations:
   - Base tool class: [`src/tools/base.ts`](src/tools/base.ts)
   - Example implementation: [`src/tools/search_accounts.ts`](src/tools/search_accounts.ts)
   - Tool registry: [`src/tools/index.ts`](src/tools/index.ts)
   - Tools README: [`src/tools/README.md`](src/tools/README.md)

4. Run tests:
   ```bash
   npm test
   ```

### Implementation Checklist
When implementing a new tool, follow this checklist:

- [ ] Create tool file in `src/tools/` (e.g., `get_user_profile.ts`)
- [ ] Extend `BaseTool` class from `base.ts`
- [ ] Implement `getDefinition()` method with proper schema
- [ ] Implement `execute()` method with error handling
- [ ] Add tool instance to `src/tools/index.ts` array
- [ ] Write unit tests in `src/__tests__/`
- [ ] Test manually using the MCP server
- [ ] Update this `plan.md` with status (✅ Implemented)
- [ ] Submit PR with clear description and test results

### How to Claim a Tool
1. Check if tool is already assigned (see status in tool list below)
2. Comment on related GitHub issue or create a new one
3. Update this plan with your GitHub username in the "Assigned to" field
4. Start implementation following the checklist above

### Code Style Guidelines
- Follow existing TypeScript patterns
- Use async/await for API calls
- Handle errors gracefully using `executeWithErrorHandling()` from BaseTool
- Add JSDoc comments for public methods
- Use descriptive variable names
- Validate all input parameters

---

## Implementation Status

### Overall Progress

**Implemented**: 4 tools ✅ | **In Progress**: 0 tools 🚧 | **Planned**: 112 tools 📋

```
Progress: ███░░░░░░░ 3.4%
```

### Progress by Tier

| Tier | Category | Implemented | Total | Progress |
|------|----------|------------|-------|----------|
| Auth | Authentication | 3 | 3 | ██████████ 100% |
| Tier 1 | Core Profile & Content Viewing | 1 | 6 | ██░░░░░░░░ 16.7% |
| Tier 2 | Engagement Actions | 0 | 7 | ░░░░░░░░░░ 0% |
| Tier 3 | Social Actions | 0 | 10 | ░░░░░░░░░░ 0% |
| Tier 4 | Content Publishing | 0 | 9 | ░░░░░░░░░░ 0% |
| Tier 5 | Direct Messages | 0 | 9 | ░░░░░░░░░░ 0% |
| Tier 6 | Search & Discovery | 0 | 7 | ░░░░░░░░░░ 0% |
| Tier 7 | Stories & Reels | 0 | 8 | ░░░░░░░░░░ 0% |
| Tier 8 | Profile Management | 0 | 8 | ░░░░░░░░░░ 0% |
| Tier 9 | Advanced Features | 0 | 11 | ░░░░░░░░░░ 0% |
| Tier 10 | Live & IGTV | 0 | 11 | ░░░░░░░░░░ 0% |
| Tier 11 | Music & Advanced Content | 0 | 4 | ░░░░░░░░░░ 0% |
| Tier 12 | Utility & Advanced | 0 | 26 | ░░░░░░░░░░ 0% |

### Currently Implemented Tools

| Tool Name | Category | File | Status |
|-----------|----------|------|--------|
| `instagram_login` | Auth | [`src/tools/login.ts`](src/tools/login.ts) | ✅ Complete |
| `instagram_complete_2fa` | Auth | [`src/tools/complete_2fa.ts`](src/tools/complete_2fa.ts) | ✅ Complete |
| `instagram_search_accounts` | Tier 1 | [`src/tools/search_accounts.ts`](src/tools/search_accounts.ts) | ✅ Complete |
| `instagram_get_user_profile` | Tier 1 | [`src/tools/get_user_profile.ts`](src/tools/get_user_profile.ts) | ✅ Complete |

### Legend
- ✅ **Implemented** - Tool is complete and tested
- 🚧 **In Progress** - Tool is being worked on
- 📋 **Planned** - Tool is ready to be implemented
- 🔴 **Blocked** - Tool implementation is blocked by dependencies or issues
- ⏳ **[CLAIM]** - Tool is available to be claimed by a contributor

---

## Analysis Summary

After examining the `instagram-private-api` library (v1.46.1), I've identified all available repositories, feeds, and services that can be implemented as MCP tools. The library provides three main categories:

1. **Repositories** - Low-level operations (single API requests)
2. **Feeds** - Paginated data endpoints (async iterable)
3. **Services** - Complex operations (multi-step workflows)

---

## Tool Priority List

### Authentication Tools (Prerequisites)

#### ✅ `instagram_login` - Account Login
- **Status**: ✅ Implemented
- **File**: [`src/tools/login.ts`](src/tools/login.ts)
- **Description**: Account login with username/password
- **API Methods**: `account.login()`
- **Parameters**: `username` (string), `password` (string)
- **Returns**: Session information, 2FA status if required

#### ✅ `instagram_complete_2fa` - Complete Two-Factor Authentication
- **Status**: ✅ Implemented
- **File**: [`src/tools/complete_2fa.ts`](src/tools/complete_2fa.ts)
- **Description**: Complete two-factor authentication after login
- **API Methods**: `account.twoFactorLogin()`
- **Parameters**: `verification_code` (string)
- **Returns**: Authentication success status

---

### TIER 1: Core Profile & Content Viewing (Highest Priority)

#### 1. Get User Profile
- **Status**: ✅ Implemented
- **File**: [`src/tools/get_user_profile.ts`](src/tools/get_user_profile.ts)
- **API Methods**: `user.info`, `user.usernameinfo`
- **Description**: Get profile information by user ID or username
- **Parameters**:
  - `userId` (string, optional): Instagram user ID
  - `username` (string, optional): Instagram username (alternative to userId)
- **Returns**: Profile object with:
  - username, full name, bio
  - follower/following counts, posts count
  - verification status, profile picture URL
  - is_private, is_business_account flags
- **Example Implementation**: See [`src/tools/search_accounts.ts`](src/tools/search_accounts.ts) for pattern

#### 2. Get Current User Profile ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_current_user_profile.ts` (to be created)
- **API Methods**: `account.currentUser`
- **Description**: Get logged-in user's own profile information
- **Parameters**: None (uses authenticated session)
- **Returns**: Complete account details for logged-in user
- **Notes**: Requires authentication
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 3. Get User Posts Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_user_posts.ts` (to be created)
- **API Methods**: `feed.user()`
- **Description**: Get paginated feed of a user's posts
- **Parameters**:
  - `userId` (string): User ID to get posts from
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of posts to fetch (default: 12)
- **Returns**: Array of posts with:
  - media URLs, captions, likes count, comments count
  - post ID, timestamp, media type
- **Notes**: Supports pagination via maxId cursor
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 4. Get Post Details ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_post_details.ts` (to be created)
- **API Methods**: `media.info`
- **Description**: Get detailed information about a specific post
- **Parameters**:
  - `mediaId` (string): Post/media ID
- **Returns**: Media details including:
  - caption, comments, likes, engagement metrics
  - media URLs, dimensions, location (if available)
  - author information
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 5. Get User Stories ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_user_stories.ts` (to be created)
- **API Methods**: `feed.userStory()`
- **Description**: Get active stories from a user
- **Parameters**:
  - `userId` (string): User ID to get stories from
- **Returns**: Story items with:
  - media URLs, timestamps
  - story type, duration
  - viewer count (if own stories)
- **Notes**: Stories expire after 24 hours
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 6. Get Timeline Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_timeline_feed.ts` (to be created)
- **API Methods**: `feed.timeline()`
- **Description**: Get home feed (posts from followed accounts)
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of posts to fetch
- **Returns**: Paginated feed of posts from followed accounts
- **Notes**: Requires authentication, supports pagination
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 2: Engagement Actions (High Priority)

#### 7. Like Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/like_post.ts` (to be created)
- **API Methods**: `media.like`
- **Description**: Like a post or reel
- **Parameters**:
  - `mediaId` (string): Post/media ID to like
  - `module` (string, optional): Module info for tracking
- **Returns**: Success status
- **Notes**: Requires authentication
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 8. Unlike Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unlike_post.ts` (to be created)
- **API Methods**: `media.unlike`
- **Description**: Unlike a post or reel
- **Parameters**:
  - `mediaId` (string): Post/media ID to unlike
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 9. Comment on Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/comment_on_post.ts` (to be created)
- **API Methods**: `media.comment`
- **Description**: Add a comment to a post
- **Parameters**:
  - `mediaId` (string): Post/media ID
  - `text` (string): Comment text
  - `replyToCommentId` (string, optional): ID of comment to reply to
- **Returns**: Created comment object with ID
- **Notes**: Comment length limits apply
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 10. Get Post Comments ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_post_comments.ts` (to be created)
- **API Methods**: `feed.mediaComments()`
- **Description**: Get comments for a post
- **Parameters**:
  - `mediaId` (string): Post/media ID
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of comments to fetch
- **Returns**: Paginated list of comments with author info
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 11. Like Comment ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/like_comment.ts` (to be created)
- **API Methods**: `media.likeComment`
- **Description**: Like a comment
- **Parameters**:
  - `commentId` (string): Comment ID to like
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 12. Unlike Comment ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unlike_comment.ts` (to be created)
- **API Methods**: `media.unlikeComment`
- **Description**: Unlike a comment
- **Parameters**:
  - `commentId` (string): Comment ID to unlike
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 13. Delete Comment ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/delete_comment.ts` (to be created)
- **API Methods**: `media.commentsBulkDelete`
- **Description**: Delete one or more comments
- **Parameters**:
  - `mediaId` (string): Post/media ID
  - `commentIds` (string[]): Array of comment IDs to delete
- **Returns**: Success status
- **Notes**: Can only delete own comments or comments on own posts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 3: Social Actions (High Priority)

#### 14. Follow User ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/follow_user.ts` (to be created)
- **API Methods**: `friendship.create`
- **Description**: Follow a user
- **Parameters**:
  - `userId` (string): User ID to follow
- **Returns**: Friendship status
- **Notes**: May require approval for private accounts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 15. Unfollow User ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unfollow_user.ts` (to be created)
- **API Methods**: `friendship.destroy`
- **Description**: Unfollow a user
- **Parameters**:
  - `userId` (string): User ID to unfollow
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 16. Get Followers ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_followers.ts` (to be created)
- **API Methods**: `feed.accountFollowers()`
- **Description**: Get paginated list of a user's followers
- **Parameters**:
  - `userId` (string): User ID
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of followers to fetch
- **Returns**: Paginated list of follower accounts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 17. Get Following ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_following.ts` (to be created)
- **API Methods**: `feed.accountFollowing()`
- **Description**: Get paginated list of users a person follows
- **Parameters**:
  - `userId` (string): User ID
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of following to fetch
- **Returns**: Paginated list of accounts being followed
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 18. Get Friendship Status ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_friendship_status.ts` (to be created)
- **API Methods**: `friendship.show`
- **Description**: Check relationship status with a user
- **Parameters**:
  - `userId` (string): User ID to check
- **Returns**: Relationship object with:
  - following, followed_by, blocking, blocked_by
  - outgoing_request, incoming_request
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 19. Block User ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/block_user.ts` (to be created)
- **API Methods**: `friendship.block`
- **Description**: Block a user
- **Parameters**:
  - `userId` (string): User ID to block
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 20. Unblock User ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unblock_user.ts` (to be created)
- **API Methods**: `friendship.unblock`
- **Description**: Unblock a user
- **Parameters**:
  - `userId` (string): User ID to unblock
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 21. Approve Follow Request ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/approve_follow_request.ts` (to be created)
- **API Methods**: `friendship.approve`
- **Description**: Approve a pending follow request
- **Parameters**:
  - `userId` (string): User ID of requester
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 22. Deny Follow Request ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/deny_follow_request.ts` (to be created)
- **API Methods**: `friendship.deny`
- **Description**: Deny a pending follow request
- **Parameters**:
  - `userId` (string): User ID of requester
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 23. Remove Follower ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/remove_follower.ts` (to be created)
- **API Methods**: `friendship.removeFollower`
- **Description**: Remove a follower
- **Parameters**:
  - `userId` (string): User ID to remove as follower
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 4: Content Publishing (Medium-High Priority)

#### 24. Upload Photo Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/upload_photo_post.ts` (to be created)
- **API Methods**: `publish.photo()`
- **Description**: Upload and publish a photo post
- **Parameters**:
  - `file` (buffer/string): Photo file buffer or file path
  - `caption` (string, optional): Post caption
  - `location` (object, optional): Location data with id and name
- **Returns**: Published post object with media ID
- **Notes**: File uploads require buffer handling
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 25. Upload Video Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/upload_video_post.ts` (to be created)
- **API Methods**: `publish.video()`
- **Description**: Upload and publish a video post
- **Parameters**:
  - `file` (buffer/string): Video file buffer or file path
  - `caption` (string, optional): Post caption
  - `location` (object, optional): Location data
  - `coverImage` (buffer/string, optional): Thumbnail image
- **Returns**: Published post object with media ID
- **Notes**: Video uploads may take longer, consider async handling
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 26. Upload Album/Carousel ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/upload_album.ts` (to be created)
- **API Methods**: `publish.album()`
- **Description**: Upload multiple photos/videos as a carousel
- **Parameters**:
  - `files` (array): Array of media files (buffers or paths)
  - `caption` (string, optional): Post caption
- **Returns**: Published album object with media IDs
- **Notes**: Supports mix of photos and videos
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 27. Upload Story Photo ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/upload_story_photo.ts` (to be created)
- **API Methods**: `publish.story()`
- **Description**: Upload a photo to stories
- **Parameters**:
  - `file` (buffer/string): Photo file buffer or file path
  - `stickers` (array, optional): Story stickers/effects
- **Returns**: Published story object
- **Notes**: Stories expire after 24 hours
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 28. Upload Story Video ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/upload_story_video.ts` (to be created)
- **API Methods**: `publish.story()`
- **Description**: Upload a video to stories
- **Parameters**:
  - `file` (buffer/string): Video file buffer or file path
  - `stickers` (array, optional): Story stickers/effects
- **Returns**: Published story object
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 29. Edit Post Caption ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/edit_post_caption.ts` (to be created)
- **API Methods**: `media.editMedia`
- **Description**: Edit the caption of an existing post
- **Parameters**:
  - `mediaId` (string): Post/media ID
  - `caption` (string): New caption text
- **Returns**: Updated post object
- **Notes**: Can only edit own posts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 30. Delete Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/delete_post.ts` (to be created)
- **API Methods**: `media.delete`
- **Description**: Delete a post, video, or carousel
- **Parameters**:
  - `mediaId` (string): Post/media ID to delete
  - `mediaType` (string, optional): Type of media (PHOTO, VIDEO, CAROUSEL)
- **Returns**: Success status
- **Notes**: Can only delete own posts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 31. Save Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/save_post.ts` (to be created)
- **API Methods**: `media.save`
- **Description**: Save a post to collections
- **Parameters**:
  - `mediaId` (string): Post/media ID to save
  - `collectionIds` (string[], optional): Collection IDs to save to
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 32. Unsave Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unsave_post.ts` (to be created)
- **API Methods**: `media.unsave`
- **Description**: Remove a post from saved collections
- **Parameters**:
  - `mediaId` (string): Post/media ID to unsave
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 5: Direct Messages (Medium Priority)

#### 33. Get Direct Inbox ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_direct_inbox.ts` (to be created)
- **API Methods**: `feed.directInbox()`
- **Description**: Get paginated list of direct message threads
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of threads to fetch
- **Returns**: List of conversations with preview messages
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 34. Get Direct Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_direct_thread.ts` (to be created)
- **API Methods**: `feed.directThread()`
- **Description**: Get messages from a specific thread
- **Parameters**:
  - `threadId` (string): Thread ID
  - `maxId` (string, optional): Cursor for pagination
  - `limit` (number, optional): Number of messages to fetch
- **Returns**: Paginated list of messages in thread
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 35. Send Direct Message ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/send_direct_message.ts` (to be created)
- **API Methods**: `directThread.broadcast`
- **Description**: Send a message in a direct thread
- **Parameters**:
  - `threadId` (string): Thread ID
  - `message` (string): Message text
  - `media` (object, optional): Media attachment
- **Returns**: Sent message object
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 36. Create Group Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/create_group_thread.ts` (to be created)
- **API Methods**: `direct.createGroupThread`
- **Description**: Create a new group chat
- **Parameters**:
  - `userIds` (string[]): Array of recipient user IDs
  - `title` (string, optional): Group thread title
- **Returns**: Created thread object
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 37. Mark Message as Seen ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/mark_message_seen.ts` (to be created)
- **API Methods**: `directThread.markItemSeen`
- **Description**: Mark a message as read
- **Parameters**:
  - `threadId` (string): Thread ID
  - `threadItemId` (string): Message/item ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 38. Delete Message ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/delete_message.ts` (to be created)
- **API Methods**: `directThread.deleteItem`
- **Description**: Delete a message from a thread
- **Parameters**:
  - `threadId` (string): Thread ID
  - `itemId` (string): Message/item ID to delete
- **Returns**: Success status
- **Notes**: Can only delete own messages
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 39. Get Pending Inbox ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_pending_inbox.ts` (to be created)
- **API Methods**: `feed.directPending()`
- **Description**: Get messages from users you don't follow
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of pending threads
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 40. Approve Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/approve_thread.ts` (to be created)
- **API Methods**: `directThread.approve`
- **Description**: Approve a pending message request
- **Parameters**:
  - `threadId` (string): Thread ID to approve
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 41. Decline Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/decline_thread.ts` (to be created)
- **API Methods**: `directThread.decline`
- **Description**: Decline a pending message request
- **Parameters**:
  - `threadId` (string): Thread ID to decline
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 6: Search & Discovery (Medium Priority)

#### 42. Search Tags ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/search_tags.ts` (to be created)
- **API Methods**: `tag.search`
- **Description**: Search for hashtags
- **Parameters**:
  - `query` (string): Search query string
- **Returns**: Matching hashtags with post counts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 43. Get Tag Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_tag_feed.ts` (to be created)
- **API Methods**: `feed.tag()`
- **Description**: Get posts for a specific hashtag
- **Parameters**:
  - `tag` (string): Hashtag name (without #)
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated feed of posts with the hashtag
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 44. Search Locations ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/search_locations.ts` (to be created)
- **API Methods**: `locationSearch.repository`
- **Description**: Search for locations/places
- **Parameters**:
  - `query` (string): Search query string
- **Returns**: Matching locations with coordinates
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 45. Get Location Info ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_location_info.ts` (to be created)
- **API Methods**: `location.info`
- **Description**: Get information about a location
- **Parameters**:
  - `locationId` (string): Location ID
- **Returns**: Location details, coordinates, address
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 46. Get Location Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_location_feed.ts` (to be created)
- **API Methods**: `feed.location()`
- **Description**: Get posts from a specific location
- **Parameters**:
  - `locationId` (string): Location ID
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated feed of posts at location
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 47. Get Discover Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_discover_feed.ts` (to be created)
- **API Methods**: `feed.discover()`
- **Description**: Get explore/discover page content
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Suggested posts and accounts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 48. Get Topical Explore ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_topical_explore.ts` (to be created)
- **API Methods**: `discover.topicalExplore`
- **Description**: Get topic-based explore content
- **Parameters**:
  - `topicId` (string, optional): Topic ID
- **Returns**: Curated content by topic
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 7: Stories & Reels (Medium Priority)

#### 49. Get Reels Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_reels_feed.ts` (to be created)
- **API Methods**: `feed.reelsMedia()`
- **Description**: Get reels from a user
- **Parameters**:
  - `userId` (string): User ID
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated feed of reels
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 50. Get Reels Tray ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_reels_tray.ts` (to be created)
- **API Methods**: `feed.reelsTray()`
- **Description**: Get stories/reels tray (home page stories)
- **Parameters**: None
- **Returns**: Active stories from followed accounts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 51. View Story ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/view_story.ts` (to be created)
- **API Methods**: `story.seen`
- **Description**: Mark stories as viewed
- **Parameters**:
  - `storyItems` (array): Array of story item objects with media IDs
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 52. Get Story Viewers ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_story_viewers.ts` (to be created)
- **API Methods**: `feed.listReelMediaViewer()`
- **Description**: Get list of users who viewed a story
- **Parameters**:
  - `mediaId` (string): Story media ID
- **Returns**: List of viewers with timestamps
- **Notes**: Only available for own stories
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 53. Interact with Story Poll ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/story_poll_vote.ts` (to be created)
- **API Methods**: `media.storyPollVote`
- **Description**: Vote on a story poll
- **Parameters**:
  - `mediaId` (string): Story media ID
  - `pollId` (string): Poll ID
  - `vote` (number): Vote value (0 or 1)
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 54. Respond to Story Question ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/story_question_response.ts` (to be created)
- **API Methods**: `media.storyQuestionResponse`
- **Description**: Answer a story question
- **Parameters**:
  - `mediaId` (string): Story media ID
  - `questionId` (string): Question ID
  - `response` (string): Response text
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 55. Vote on Story Slider ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/story_slider_vote.ts` (to be created)
- **API Methods**: `media.storySliderVote`
- **Description**: Vote on a story slider/emoji
- **Parameters**:
  - `mediaId` (string): Story media ID
  - `sliderId` (string): Slider ID
  - `vote` (number): Vote value
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 56. Answer Story Quiz ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/story_quiz_answer.ts` (to be created)
- **API Methods**: `media.storyQuizAnswer`
- **Description**: Answer a story quiz question
- **Parameters**:
  - `mediaId` (string): Story media ID
  - `quizId` (string): Quiz ID
  - `answer` (number): Answer index
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 8: Profile Management (Medium-Low Priority)

#### 57. Edit Profile ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/edit_profile.ts` (to be created)
- **API Methods**: `account.editProfile`
- **Description**: Edit profile information
- **Parameters**:
  - `fullName` (string, optional): Full name
  - `biography` (string, optional): Bio text
  - `externalUrl` (string, optional): External URL
  - `phoneNumber` (string, optional): Phone number
  - `email` (string, optional): Email address
  - `gender` (number, optional): Gender (1=male, 2=female, 3=prefer not to say)
- **Returns**: Updated profile object
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 58. Change Profile Picture ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/change_profile_picture.ts` (to be created)
- **API Methods**: `account.changeProfilePicture`
- **Description**: Update profile picture
- **Parameters**:
  - `image` (buffer/string): Image file buffer or file path
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 59. Remove Profile Picture ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/remove_profile_picture.ts` (to be created)
- **API Methods**: `account.removeProfilePicture`
- **Description**: Remove profile picture (revert to default)
- **Parameters**: None
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 60. Set Biography ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/set_biography.ts` (to be created)
- **API Methods**: `account.setBiography`
- **Description**: Update profile bio
- **Parameters**:
  - `biography` (string): Biography text
- **Returns**: Success status
- **Notes**: Character limit applies
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 61. Set Account Private ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/set_account_private.ts` (to be created)
- **API Methods**: `account.setPrivate`
- **Description**: Make account private
- **Parameters**: None
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 62. Set Account Public ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/set_account_public.ts` (to be created)
- **API Methods**: `account.setPublic`
- **Description**: Make account public
- **Parameters**: None
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 63. Change Password ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/change_password.ts` (to be created)
- **API Methods**: `account.changePassword`
- **Description**: Change account password
- **Parameters**:
  - `oldPassword` (string): Current password
  - `newPassword` (string): New password
- **Returns**: Success status
- **Notes**: Security-sensitive operation
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 64. Get Blocked Users ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_blocked_users.ts` (to be created)
- **API Methods**: `feed.blockedUsers()`
- **Description**: Get list of blocked users
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of blocked users
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 9: Advanced Features (Low-Medium Priority)

#### 65. Get Post Likers ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_post_likers.ts` (to be created)
- **API Methods**: `media.likers`
- **Description**: Get list of users who liked a post
- **Parameters**:
  - `mediaId` (string): Post/media ID
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of users who liked the post
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 66. Get Saved Posts ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_saved_posts.ts` (to be created)
- **API Methods**: `feed.saved()`
- **Description**: Get saved posts
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of saved posts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 67. Get Liked Posts ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_liked_posts.ts` (to be created)
- **API Methods**: `feed.liked()`
- **Description**: Get posts the user has liked
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of liked posts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 68. Get User Tags ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_user_tags.ts` (to be created)
- **API Methods**: `feed.usertags()`
- **Description**: Get posts where user is tagged
- **Parameters**:
  - `userId` (string): User ID
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of posts where user is tagged
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 69. Get Highlights ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_highlights.ts` (to be created)
- **API Methods**: `highlights.highlightsTray`
- **Description**: Get story highlights for a user
- **Parameters**:
  - `userId` (string): User ID
- **Returns**: Highlights collections with cover images
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 70. Create Highlight ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/create_highlight.ts` (to be created)
- **API Methods**: `highlights.createReel`
- **Description**: Create a story highlight
- **Parameters**:
  - `mediaIds` (string[]): Array of story media IDs
  - `title` (string): Highlight title
  - `coverMediaId` (string, optional): Cover media ID
- **Returns**: Created highlight object
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 71. Edit Highlight ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/edit_highlight.ts` (to be created)
- **API Methods**: `highlights.editReel`
- **Description**: Edit a highlight
- **Parameters**:
  - `highlightId` (string): Highlight ID
  - `title` (string, optional): New title
  - `coverMediaId` (string, optional): New cover media ID
  - `mediaIds` (string[], optional): Updated media IDs array
- **Returns**: Updated highlight object
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 72. Delete Highlight ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/delete_highlight.ts` (to be created)
- **API Methods**: `highlights.deleteReel`
- **Description**: Delete a highlight
- **Parameters**:
  - `highlightId` (string): Highlight ID to delete
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 73. Set Best Friends ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/set_best_friends.ts` (to be created)
- **API Methods**: `friendship.setBesties`
- **Description**: Set close friends list
- **Parameters**:
  - `add` (string[], optional): User IDs to add to close friends
  - `remove` (string[], optional): User IDs to remove from close friends
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 74. Mute User Posts/Stories ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/mute_user.ts` (to be created)
- **API Methods**: `friendship.mutePostsOrStoryFromFollow`
- **Description**: Mute posts or stories from a user
- **Parameters**:
  - `userId` (string): User ID to mute
  - `mutePosts` (boolean, optional): Mute posts (default: true)
  - `muteStories` (boolean, optional): Mute stories (default: true)
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 75. Unmute User Posts/Stories ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unmute_user.ts` (to be created)
- **API Methods**: `friendship.unmutePostsOrStoryFromFollow`
- **Description**: Unmute posts or stories from a user
- **Parameters**:
  - `userId` (string): User ID to unmute
  - `unmutePosts` (boolean, optional): Unmute posts (default: true)
  - `unmuteStories` (boolean, optional): Unmute stories (default: true)
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 10: Live & IGTV (Lower Priority)

#### 76. Create Live Broadcast ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/create_live_broadcast.ts` (to be created)
- **API Methods**: `live.create`
- **Description**: Start a live broadcast
- **Parameters**:
  - `previewWidth` (number): Preview width
  - `previewHeight` (number): Preview height
  - `message` (string, optional): Broadcast message
- **Returns**: Broadcast object with broadcast ID
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 77. Start Live Broadcast ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/start_live_broadcast.ts` (to be created)
- **API Methods**: `live.start`
- **Description**: Begin streaming
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 78. End Live Broadcast ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/end_live_broadcast.ts` (to be created)
- **API Methods**: `live.endBroadcast`
- **Description**: End a live stream
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 79. Get Live Info ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_live_info.ts` (to be created)
- **API Methods**: `live.info`
- **Description**: Get information about a live broadcast
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
- **Returns**: Live broadcast information
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 80. Get Live Comments ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_live_comments.ts` (to be created)
- **API Methods**: `live.getComment`
- **Description**: Get comments from a live stream
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
  - `commentsRequested` (number, optional): Number of comments to fetch
  - `lastCommentTs` (number, optional): Last comment timestamp for pagination
- **Returns**: List of live comments
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 81. Comment on Live ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/comment_on_live.ts` (to be created)
- **API Methods**: `live.comment`
- **Description**: Comment on a live stream
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
  - `message` (string): Comment text
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 82. Like Live Stream ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/like_live_stream.ts` (to be created)
- **API Methods**: `live.like`
- **Description**: Like a live stream
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
  - `likeCount` (number, optional): Number of likes to send
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 83. Get Live Viewers ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_live_viewers.ts` (to be created)
- **API Methods**: `live.getViewerList`
- **Description**: Get list of viewers
- **Parameters**:
  - `broadcastId` (string): Broadcast ID
- **Returns**: List of viewers
- **Notes**: Only available for own broadcasts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 84. Get IGTV Channel ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_igtv_channel.ts` (to be created)
- **API Methods**: `feed.igtvChannel()`
- **Description**: Get IGTV videos from a user
- **Parameters**:
  - `userId` (string): User ID
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated feed of IGTV videos
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 85. Get IGTV Browse ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_igtv_browse.ts` (to be created)
- **API Methods**: `feed.igtvBrowse()`
- **Description**: Browse IGTV content
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Trending IGTV videos
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 86. Upload IGTV Video ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/upload_igtv_video.ts` (to be created)
- **API Methods**: `publish.igtvVideo()`
- **Description**: Upload an IGTV video
- **Parameters**:
  - `video` (buffer/string): Video file buffer or file path
  - `title` (string): Video title
  - `description` (string, optional): Video description
  - `cover` (buffer/string, optional): Cover image
- **Returns**: Published IGTV video object
- **Notes**: IGTV videos have specific length requirements
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 11: Music & Advanced Content (Lower Priority)

#### 87. Search Music ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/search_music.ts` (to be created)
- **API Methods**: `feed.musicSearch()`
- **Description**: Search for music tracks
- **Parameters**:
  - `query` (string): Search query string
- **Returns**: Matching music tracks
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 88. Get Trending Music ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_trending_music.ts` (to be created)
- **API Methods**: `feed.musicTrending()`
- **Description**: Get trending music
- **Parameters**: None
- **Returns**: Popular tracks
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 89. Get Music by Genre ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_music_by_genre.ts` (to be created)
- **API Methods**: `feed.musicGenre()`
- **Description**: Get music by genre
- **Parameters**:
  - `genreId` (string): Genre ID
- **Returns**: Music tracks in genre
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 90. Get Music by Mood ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_music_by_mood.ts` (to be created)
- **API Methods**: `feed.musicMood()`
- **Description**: Get music by mood
- **Parameters**:
  - `moodId` (string): Mood ID
- **Returns**: Music tracks matching mood
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

### TIER 12: Utility & Advanced (Lowest Priority)

#### 91. Get User ID by Username ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_user_id_by_username.ts` (to be created)
- **API Methods**: `user.getIdByUsername`
- **Description**: Convert username to user ID
- **Parameters**:
  - `username` (string): Instagram username
- **Returns**: User ID
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 92. Get Account Details ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_account_details.ts` (to be created)
- **API Methods**: `user.accountDetails`
- **Description**: Get detailed account information
- **Parameters**:
  - `userId` (string, optional): User ID (defaults to current user)
- **Returns**: Detailed account information
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 93. Get Former Usernames ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_former_usernames.ts` (to be created)
- **API Methods**: `user.formerUsernames`
- **Description**: Get username history
- **Parameters**:
  - `userId` (string): User ID
- **Returns**: Array of former usernames
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 94. Get Shared Followers ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_shared_followers.ts` (to be created)
- **API Methods**: `user.sharedFollowerAccounts`
- **Description**: Get accounts followed by both users
- **Parameters**:
  - `userId` (string): User ID to compare with
- **Returns**: List of shared followers
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 95. Flag User ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/flag_user.ts` (to be created)
- **API Methods**: `user.flagUser`
- **Description**: Report a user
- **Parameters**:
  - `userId` (string): User ID to report
  - `reason` (string, optional): Reason for reporting
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 96. Check Offensive Comment ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/check_offensive_comment.ts` (to be created)
- **API Methods**: `media.checkOffensiveComment`
- **Description**: Check if comment text is offensive
- **Parameters**:
  - `commentText` (string): Comment text to check
  - `mediaId` (string, optional): Associated media ID
- **Returns**: Offensive status and confidence score
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 97. Disable Comments ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/disable_comments.ts` (to be created)
- **API Methods**: `media.commentsDisable`
- **Description**: Disable comments on a post
- **Parameters**:
  - `mediaId` (string): Post/media ID
- **Returns**: Success status
- **Notes**: Can only disable comments on own posts
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 98. Enable Comments ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/enable_comments.ts` (to be created)
- **API Methods**: `media.commentsEnable`
- **Description**: Enable comments on a post
- **Parameters**:
  - `mediaId` (string): Post/media ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 99. Archive Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/archive_post.ts` (to be created)
- **API Methods**: `media.onlyMe`
- **Description**: Archive a post (hide from profile)
- **Parameters**:
  - `mediaId` (string): Post/media ID to archive
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 100. Unarchive Post ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unarchive_post.ts` (to be created)
- **API Methods**: `media.undoOnlyMe`
- **Description**: Unarchive a post
- **Parameters**:
  - `mediaId` (string): Post/media ID to unarchive
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 101. Get News Feed ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_news_feed.ts` (to be created)
- **API Methods**: `feed.news()`
- **Description**: Get activity/notifications feed
- **Parameters**:
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Recent activity and notifications
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 102. Get Posts Insights ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_posts_insights.ts` (to be created)
- **API Methods**: `feed.postsInsights()`
- **Description**: Get analytics for posts (business accounts)
- **Parameters**:
  - `timeframe` (string, optional): Time period for insights
- **Returns**: Engagement metrics and analytics
- **Notes**: Requires business/creator account
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 103. Get Stories Insights ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_stories_insights.ts` (to be created)
- **API Methods**: `feed.storiesInsights()`
- **Description**: Get analytics for stories (business accounts)
- **Parameters**:
  - `timeframe` (string, optional): Time period for insights
- **Returns**: View metrics and analytics
- **Notes**: Requires business/creator account
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 104. Get Direct Presence ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_direct_presence.ts` (to be created)
- **API Methods**: `direct.getPresence`
- **Description**: Get online status of users
- **Parameters**: None
- **Returns**: Active users and their online status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 105. Get Ranked Recipients ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_ranked_recipients.ts` (to be created)
- **API Methods**: `direct.rankedRecipients`
- **Description**: Get suggested message recipients
- **Parameters**:
  - `mode` (string, optional): Recipient mode
  - `query` (string, optional): Search query
- **Returns**: Suggested recipients list
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 106. Add User to Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/add_user_to_thread.ts` (to be created)
- **API Methods**: `directThread.addUser`
- **Description**: Add user to group chat
- **Parameters**:
  - `threadId` (string): Thread ID
  - `userIds` (string[]): Array of user IDs to add
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 107. Leave Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/leave_thread.ts` (to be created)
- **API Methods**: `directThread.leave`
- **Description**: Leave a group chat
- **Parameters**:
  - `threadId` (string): Thread ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 108. Update Thread Title ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/update_thread_title.ts` (to be created)
- **API Methods**: `directThread.updateTitle`
- **Description**: Change group chat name
- **Parameters**:
  - `threadId` (string): Thread ID
  - `title` (string): New thread title
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 109. Mute Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/mute_thread.ts` (to be created)
- **API Methods**: `directThread.mute`
- **Description**: Mute notifications for a thread
- **Parameters**:
  - `threadId` (string): Thread ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 110. Unmute Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/unmute_thread.ts` (to be created)
- **API Methods**: `directThread.unmute`
- **Description**: Unmute notifications for a thread
- **Parameters**:
  - `threadId` (string): Thread ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 111. Hide Thread ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/hide_thread.ts` (to be created)
- **API Methods**: `directThread.hide`
- **Description**: Hide a thread from inbox
- **Parameters**:
  - `threadId` (string): Thread ID
- **Returns**: Success status
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 112. Get Location Story ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_location_story.ts` (to be created)
- **API Methods**: `location.story`
- **Description**: Get stories from a location
- **Parameters**:
  - `locationId` (string): Location ID
- **Returns**: Stories from the location
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 113. Get Tag Section ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_tag_section.ts` (to be created)
- **API Methods**: `tag.section`
- **Description**: Get curated tag content
- **Parameters**:
  - `tag` (string): Hashtag name (without #)
  - `tab` (string, optional): Tab type (top, recent, etc.)
- **Returns**: Curated content for the tag
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 114. Get Media Sticker Responses ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_media_sticker_responses.ts` (to be created)
- **API Methods**: `feed.mediaStickerResponses()`
- **Description**: Get responses to story stickers (polls, questions)
- **Parameters**:
  - `mediaId` (string): Story media ID
- **Returns**: Sticker responses (poll votes, question answers, etc.)
- **Notes**: Only available for own stories
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 115. Get Inline Child Comments ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/get_inline_child_comments.ts` (to be created)
- **API Methods**: `feed.mediaInlineChildComments()`
- **Description**: Get replies to a comment
- **Parameters**:
  - `mediaId` (string): Post/media ID
  - `commentId` (string): Parent comment ID
  - `maxId` (string, optional): Cursor for pagination
- **Returns**: Paginated list of comment replies
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

#### 116. Logout ⏳ [CLAIM]
- **Status**: 📋 Planned
- **File**: `src/tools/logout.ts` (to be created)
- **API Methods**: `account.logout`
- **Description**: Log out from Instagram
- **Parameters**: None
- **Returns**: Success status
- **Notes**: Clears session data
- **Related Issue**: _Create GitHub issue_
- **Assigned to**: _Available for contribution_

---

## Contribution Guidelines

### Code Style
- Follow existing TypeScript patterns in the codebase
- Use async/await for API calls (avoid callbacks)
- Handle errors gracefully using `executeWithErrorHandling()` from BaseTool
- Add JSDoc comments for public methods
- Use descriptive variable names
- Validate all input parameters before use

### Testing Requirements
- **Unit tests required** for all new tools
- Tests should cover:
  - Successful execution with valid inputs
  - Error handling for invalid inputs
  - Edge cases (empty results, rate limits, etc.)
- Manual testing instructions should be included in PR description
- Test error cases (invalid params, API failures, authentication errors)

### PR Process
1. **Fork the repository** and create a feature branch: `feature/tool-name`
2. **Implement the tool** following the checklist in [Getting Started](#getting-started-for-contributors)
3. **Update this plan.md** with status (change 📋 to ✅)
4. **Write tests** and ensure they pass
5. **Submit PR** with:
   - Clear description of what the tool does
   - Link to related GitHub issue (if applicable)
   - Test results (unit tests + manual testing)
   - Screenshots or examples (if applicable)
   - Any breaking changes or dependencies

### PR Template
When submitting a PR, include:

```markdown
## Description
Brief description of the tool and what it does.

## Changes
- Added `tool_name.ts` in `src/tools/`
- Registered tool in `src/tools/index.ts`
- Added tests in `src/__tests__/`
- Updated `plan.md` status

## Testing
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] Error cases tested

## Related Issue
Closes #[issue-number]
```

### Questions or Need Help?
- Open a GitHub Discussion for general questions
- Check existing issues for similar implementations
- Review [`src/tools/README.md`](src/tools/README.md) for detailed implementation guide
- Look at existing tool implementations for patterns

---

## Implementation Notes

### Common Patterns

#### Feeds (Paginated Endpoints)
Feeds are paginated and should be implemented with cursor-based pagination support:
- Use `maxId` parameter for pagination cursor
- Return pagination info in response for clients to request next page
- Example: See `feed.user()` implementation pattern

#### File Uploads
File uploads (photos/videos) require buffer handling:
- Accept file buffers or file paths
- Handle file size validation
- Support different media types (photo, video, carousel)
- May need file system integration for local files

#### Rate Limiting
All tools should respect Instagram API rate limits:
- Implement retry logic with exponential backoff
- Handle rate limit errors gracefully
- Consider implementing a rate limiter utility

#### Error Handling
Error handling is critical, especially for:
- Authentication errors (not logged in, session expired)
- Permission errors (private accounts, blocked users)
- API errors (network issues, invalid parameters)
- Use `BaseTool.executeWithErrorHandling()` for consistent error responses

### Special Considerations

- **Business/Creator Accounts**: Some tools require business/creator accounts (insights, certain analytics)
- **Authentication**: Most tools require authentication (except public profile viewing)
- **2FA**: Two-factor authentication may be required for some accounts
- **Private Accounts**: Some operations require following private accounts
- **Rate Limits**: Instagram has strict rate limits - implement retry logic
- **Session Management**: Sessions may expire - handle re-authentication

### Dependencies
- `instagram-private-api` v1.46.1
- MCP SDK for tool definitions
- TypeScript for type safety

---

## Priority Rationale

**Tier 1-2**: Core functionality users expect - viewing profiles, posts, and basic engagement  
**Tier 3**: Essential social features - following, blocking, managing relationships  
**Tier 4**: Content creation - most users want to post content  
**Tier 5**: Direct messaging - important but less frequent than posts  
**Tier 6-7**: Discovery and stories - popular features but secondary to main feed  
**Tier 8**: Profile management - occasional use  
**Tier 9-12**: Advanced/specialized features - niche use cases

---

**Want to contribute?** Start with Tier 1 tools - they're the most impactful! See [Getting Started](#getting-started-for-contributors) above.

**Last Updated**: 2024 | **Total Tools**: 116 | **Implemented**: 4 | **Available for Contribution**: 112
