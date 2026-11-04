#!/usr/bin/env node

/**
 * Entry point for `npx mcp-instagram`.
 *
 * Runs the compiled server in this process, so the MCP client's stdio pipes
 * and signals reach the server directly and no child process can be orphaned.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const serverUrl = new URL('../build/server.js', import.meta.url);

if (!existsSync(fileURLToPath(serverUrl))) {
  console.error(
    'mcp-instagram: build/server.js not found. If you are running from a git checkout, run "yarn install && yarn build" first.'
  );
  process.exit(1);
}

await import(serverUrl.href);
