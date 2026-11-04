/**
 * Smoke test of the built stdio binary (build/server.js), as MCP clients
 * launch it. Runs `yarn build` first via the `pretest` script.
 *
 * The child gets a throwaway session directory, HOME and working directory
 * and no credentials, so it can neither read nor move a real saved session
 * (the server migrates legacy ./data/session.json files when IG_SESSION_DIR
 * is unset) and never contacts Instagram.
 */

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const serverPath = fileURLToPath(new URL("../../build/server.js", import.meta.url));
let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "mcp-instagram-stdio-"));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe.each([
  ["legacy", "legacy" as const],
  ["2026-07-28", { pin: "2026-07-28" }],
  ["auto-negotiated", "auto" as const],
])("stdio server with a %s client", (_label, mode) => {
  it("connects and lists the tools", async () => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      IG_SESSION_DIR: join(sandbox, "session"),
      HOME: sandbox,
      XDG_CONFIG_HOME: join(sandbox, ".config"),
    };
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      cwd: sandbox,
      env,
      stderr: "ignore",
    });
    const client = new Client({ name: "stdio-smoke", version: "0.0.0" }, { versionNegotiation: { mode } });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(15);
      expect(client.getServerVersion()?.name).toBe("mcp-instagram");
    } finally {
      await client.close();
    }
  }, 30_000);
});
