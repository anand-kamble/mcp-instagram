# Testing

```bash
yarn install
yarn test            # builds with tsc (pretest), then runs jest
yarn test:watch
yarn test:coverage
```

The suite needs no Instagram account and makes no network requests. Node.js 22 or newer is required.

## What the tests cover

| File | What it tests |
|---|---|
| `src/__tests__/server.test.ts` | Server identity (name, version from package.json, title, instructions) and `tools/list` metadata: fixed tool order, titles, annotations, output schemas and required parameters. Runs on both protocol eras. |
| `src/__tests__/auth.test.ts` | `instagram_login`, `instagram_complete_2fa` and `instagram_logout`, including the two-factor code prompt via elicitation (accept, malformed code, rejected code, dismissed prompt, client without elicitation). Runs on both protocol eras. |
| `src/__tests__/tools.test.ts` | Input validation, the login requirement, structured output and pagination of the read tools, Instagram error translation, rate limiting, and the requests the write tools send. |
| `src/__tests__/stdio.test.ts` | Spawns `build/server.js` and connects to it over stdio as a 2025-era client, a 2026-07-28 client and an auto-negotiating client. |
| `src/__tests__/instagram-api.test.ts` | The endpoint layer (`src/instagram/api.ts`): path, method, query and signed form of every call, and how responses and cursors are extracted. |
| `src/__tests__/session.test.ts`, `client.test.ts`, `instagram-client.test.ts`, `rateLimit.test.ts` | Session file storage and migration, client session handling, and the write-action rate limiter. |

"Both protocol eras" means a 2025-era client (`initialize` handshake) and a 2026-07-28 client (stateless requests with a per-request `_meta` envelope). One server process serves both through `serveStdio`.

## How the in-process tests work

`src/__tests__/helpers.ts` connects a real `Client` from `@modelcontextprotocol/client` to `createServer()` over an `InMemoryTransport`, through the same `serveStdio` era dispatch the binary uses. Instagram is replaced by a fake server: `stubInstagram(routes)` builds a real `InstagramClient` whose `fetch` is answered by the routes, and hands it to the tools. Requests, response parsing and error mapping all run for real:

```ts
const { requests } = stubInstagram([
  { method: "GET", path: "feed/user/7/", reply: { items: [post], more_available: true, next_max_id: "cursor-2" } },
]);
const result = await call(connection, "instagram_get_user_posts", { userId: "7" });
expect(result.structuredContent).toMatchObject({ nextMaxId: "cursor-2" });
```

Use `httpError(status, body)` as a reply to simulate Instagram errors. Unmatched requests get a 404, so an unexpected call fails the test.

The SDK validates `structuredContent` against each tool's `outputSchema`, so a fake response that maps to the wrong shape fails the test.

## Trying the server by hand

Use the MCP Inspector against the built server:

```bash
yarn build
npx @modelcontextprotocol/inspector node build/server.js
```

Set `IG_USERNAME` and `IG_PASSWORD` in the Inspector's environment panel to call the Instagram tools against a real account. Use a secondary account, because the tools act on Instagram for real.
