# Tools

Each file registers one MCP tool on an `McpServer` (`@modelcontextprotocol/server` v2) and exports a `register…(server)` function. `index.ts` calls them in a fixed order, which is the order clients see in `tools/list`.

## Conventions

- **Schemas.** Input and output schemas are zod 4 objects. The SDK converts them to JSON Schema for `tools/list`, validates arguments before the handler runs, and validates `structuredContent` against `outputSchema`. Don't use `.transform()` in input schemas, because it can't be represented in JSON Schema. Normalise in the handler instead.
- **Read tools** declare an `outputSchema` and return `structuredResult(data)` (`shared/results.ts`). That puts the same data in `structuredContent` and as JSON text.
- **Annotations.** Set every hint explicitly. The spec defaults (`readOnlyHint: false`, `destructiveHint: true`) would otherwise label every tool as destructive.
- **Errors.** Throw an `Error` with a message the model can act on, and the SDK turns it into an `isError` result. Wrap Instagram calls in `try/catch` and rethrow `toToolError(error, subject)` (`shared/instagram.ts`), which maps the client's `Ig*Error` classes (`src/instagram/errors.ts`) to clear messages.
- **Session.** Call `getLoggedInApi()` before any Instagram request; it returns an `InstagramApi` (`src/instagram/api.ts`), the only way tools reach Instagram. It waits for startup session restore and fails with "call instagram_login" when there is no session.
- **Pagination.** `InstagramApi` returns `nextMaxId` / `moreAvailable` with each page; pass `nextMaxId` back as `maxId` to continue.
- **Untrusted content.** Captions, comments, bios and usernames come from other users. Say so in the output field's `.describe()`.

## Adding a tool

1. Create `my_tool.ts` exporting `registerMyTool(server: McpServer)`. Follow `get_user_posts.ts` for a read tool or `like_post.ts` for a write tool. If the tool needs a new Instagram endpoint, add a method to `src/instagram/api.ts` with a fake-fetch test in `src/__tests__/instagram-api.test.ts`.
2. Add it to the `registrations` array in `index.ts`.
3. Add it to `EXPECTED_TOOLS` in `src/__tests__/server.test.ts`, and add behaviour tests against fake Instagram routes (`stubInstagram` in `src/__tests__/helpers.ts`).
