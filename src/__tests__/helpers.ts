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
import { InstagramClient } from "../instagram/client.js";
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

/** A request the fake Instagram server received. */
export interface SeenRequest {
  method: string;
  /** Path relative to /api/v1/, e.g. "users/7/info/". */
  path: string;
  query: URLSearchParams;
  /** POST fields; a signed body is decoded from `signed_body=SIGNATURE.<json>`. */
  form: Record<string, any>;
}

/** Reply with a non-200 status (the client maps it to an Ig*Error). */
export function httpError(status: number, body: Record<string, unknown> = {}) {
  return { __httpError: true as const, status, body };
}

export interface Route {
  method?: "GET" | "POST";
  /** Exact path relative to /api/v1/, or a pattern. */
  path: string | RegExp;
  /** Response body (status "ok" is added), an httpError(...), or a function of the request. */
  reply: unknown | ((request: SeenRequest) => unknown);
}

export const SESSION = { ds_user_id: "1000", sessionid: "1000%3Afake%3A1" };

/**
 * Builds a real InstagramClient (logged in as SESSION unless loggedIn is
 * false) whose fetch is answered by `routes`, and makes the igpapiClient
 * singleton hand it to the tools. Unmatched requests get a 404 and are
 * recorded, so tests fail loudly on unexpected calls. Undo with
 * `jest.restoreAllMocks()`.
 */
export function stubInstagram(routes: Route[] = [], options: { loggedIn?: boolean } = {}) {
  const loggedIn = options.loggedIn ?? true;
  const requests: SeenRequest[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1\//, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const params = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    let form: Record<string, any> = Object.fromEntries(params);
    const signed = params.get("signed_body");
    if (signed?.startsWith("SIGNATURE.")) form = JSON.parse(signed.slice("SIGNATURE.".length));
    const request: SeenRequest = { method, path, query: url.searchParams, form };
    requests.push(request);

    const route = routes.find(
      (candidate) =>
        (!candidate.method || candidate.method === method) &&
        (typeof candidate.path === "string" ? candidate.path === path : candidate.path.test(path))
    );
    let reply: any = route
      ? typeof route.reply === "function"
        ? (route.reply as (r: SeenRequest) => unknown)(request)
        : route.reply
      : httpError(404, { status: "fail", message: `no fake route for ${method} ${path}` });
    if (reply instanceof Promise) reply = await reply;
    if (reply instanceof Error) throw reply;
    const status = reply?.__httpError ? reply.status : 200;
    const body = reply?.__httpError ? reply.body : { status: "ok", ...(reply ?? {}) };
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };

  const client = new InstagramClient({ fetch: fakeFetch as typeof fetch });
  if (loggedIn) client.setAuthorization(SESSION);
  jest.spyOn(igpapiClient, "isInitialized").mockReturnValue(true);
  jest.spyOn(igpapiClient, "initialize").mockResolvedValue(undefined);
  jest.spyOn(igpapiClient, "isLoggedIn").mockReturnValue(loggedIn);
  jest.spyOn(igpapiClient, "getClient").mockReturnValue(client);
  return { client, requests };
}
