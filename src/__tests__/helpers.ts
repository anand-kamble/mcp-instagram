/**
 * Test harness: an in-process MCP client connected to the real server
 * factory through serveStdio over an in-memory transport, so the era
 * dispatch (2025 `initialize` vs 2026-07-28 `server/discover`) is the same
 * code path the stdio binary uses.
 *
 * Instagram is never contacted: tests stub methods on the `igpapiClient`
 * singleton and hand it a fake IgApiClient.
 */

import { jest } from "@jest/globals";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult, ClientCapabilities } from "@modelcontextprotocol/client";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { igpapiClient } from "../igpapi/index.js";
import { createServer } from "../mcp.js";

export type Era = "legacy" | "modern";
export const ERAS: Era[] = ["legacy", "modern"];

export interface Connection {
  client: Client;
  close(): Promise<void>;
}

export async function connect(
  era: Era,
  capabilities: ClientCapabilities = {},
  setup?: (client: Client) => void
): Promise<Connection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(createServer, { transport: serverTransport });
  const client = new Client(
    { name: "mcp-instagram-tests", version: "0.0.0" },
    {
      capabilities,
      versionNegotiation: { mode: era === "modern" ? { pin: "2026-07-28" } : "legacy" },
    }
  );
  setup?.(client);
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await handle.close();
    },
  };
}

/** Calls a tool and returns its result, failing the test on protocol errors. */
export async function call(
  connection: Connection,
  name: string,
  args: Record<string, unknown> = {}
): Promise<CallToolResult> {
  return (await connection.client.callTool({ name, arguments: args })) as CallToolResult;
}

export function textOf(result: CallToolResult): string {
  return result.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type FakeInstagram = Record<string, any>;

/**
 * Makes the singleton behave as initialised (and optionally logged in) with
 * `fake` as the underlying IgApiClient. Undo with `jest.restoreAllMocks()`.
 */
export function stubInstagram(fake: FakeInstagram = {}, options: { loggedIn?: boolean } = {}): void {
  const loggedIn = options.loggedIn ?? true;
  jest.spyOn(igpapiClient, "isInitialized").mockReturnValue(true);
  jest.spyOn(igpapiClient, "initialize").mockResolvedValue(undefined);
  jest.spyOn(igpapiClient, "isLoggedIn").mockReturnValue(loggedIn);
  jest.spyOn(igpapiClient, "getClient").mockReturnValue(fake as any);
}

/**
 * Minimal stand-in for an instagram-private-api feed. `pages` are returned
 * by successive items() calls; the cursor lives in `nextMaxId` like the real
 * feeds, and every request records the cursor it was sent with.
 */
export function fakeFeed(pages: Array<{ items: unknown[]; nextMaxId?: string }>) {
  const feed = {
    nextMaxId: undefined as string | undefined,
    moreAvailable: false,
    requestedWith: [] as Array<string | undefined>,
    async items() {
      feed.requestedWith.push(feed.nextMaxId);
      const page = pages.shift() ?? { items: [] };
      feed.nextMaxId = page.nextMaxId;
      feed.moreAvailable = Boolean(page.nextMaxId);
      return page.items;
    },
    isMoreAvailable() {
      return feed.moreAvailable;
    },
  };
  return feed;
}

/** Builds an object shaped like an igpapi HTTP response, for constructing Ig*Error instances. */
export function fakeResponse(statusCode: number, body: Record<string, unknown> = {}) {
  return {
    statusCode,
    statusMessage: "",
    body,
    request: { method: "GET", uri: { path: "/api/v1/test/" } },
  } as any;
}
