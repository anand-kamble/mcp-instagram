# Tools

Each file registers one MCP tool on an `McpServer` (`@modelcontextprotocol/server` v2) and exports a `register…(server)` function. `index.ts` calls them in a fixed order, which is the order clients see in `tools/list`.

## Conventions

- **Schemas.** Input and output schemas are zod 4 objects. The SDK converts them to JSON Schema for `tools/list`, validates arguments before the handler runs, and validates `structuredContent` against `outputSchema`. Don't use `.transform()` in input schemas, because it can't be represented in JSON Schema. Normalise in the handler instead.
- **Read tools** declare an `outputSchema` and return `structuredResult(data)` (`shared/results.ts`). That puts the same data in `structuredContent` and as JSON text.
- **Annotations.** Set every hint explicitly. The spec defaults (`readOnlyHint: false`, `destructiveHint: true`) would otherwise label every tool as destructive.
- **Errors.** Throw an `Error` with a message the model can act on, and the SDK turns it into an `isError` result. Wrap Instagram calls in `try/catch` and rethrow `toToolError(error, subject)` (`shared/instagram.ts`), which maps instagram-private-api errors to clear messages.
- **Session.** Call `getLoggedInClient()` before any Instagram request. It waits for startup session restore and fails with "call instagram_login" when there is no session.
- **Pagination.** Use `setFeedCursor` / `getFeedCursor`. instagram-private-api keeps the cursor in a feed's private `nextMaxId` field.
- **Untrusted content.** Captions, comments, bios and usernames come from other users. Say so in the output field's `.describe()`.

## Adding a tool

1. Create `my_tool.ts` exporting `registerMyTool(server: McpServer)`. Follow `get_user_posts.ts` for a read tool or `like_post.ts` for a write tool.
2. Add it to the `registrations` array in `index.ts`.
3. Add it to `EXPECTED_TOOLS` in `src/__tests__/server.test.ts`, and add behaviour tests with a fake client (see `src/__tests__/helpers.ts`).
