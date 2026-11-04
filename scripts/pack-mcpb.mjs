#!/usr/bin/env node

/**
 * Build an MCP Bundle (.mcpb) for one-click install in Claude Desktop.
 *
 * Usage: yarn build && node scripts/pack-mcpb.mjs [output.mcpb]
 *
 * Stages build/, package.json and production node_modules next to
 * mcpb/manifest.json (with the version taken from package.json), validates
 * the manifest and packs it. Output defaults to dist/mcp-instagram-<version>.mcpb.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const stage = join(root, 'dist', 'mcpb');
const output = resolve(process.argv[2] ?? join(root, 'dist', `mcp-instagram-${pkg.version}.mcpb`));

if (!existsSync(join(root, 'build', 'server.js'))) {
  console.error('build/server.js not found. Run "yarn build" first.');
  process.exit(1);
}

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// NOTICE carries the license of the ported instagrapi code and must ship with every copy.
const REQUIRED_IN_BUNDLE = ['manifest.json', 'package.json', 'README.md', 'LICENSE.md', 'NOTICE', 'build/server.js'];

for (const entry of ['build', 'package.json', 'yarn.lock', 'README.md', 'LICENSE.md', 'NOTICE']) {
  cpSync(join(root, entry), join(stage, entry), { recursive: true });
}

const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Production dependencies only; install scripts are not needed by any runtime dependency.
run('yarn', ['install', '--production', '--frozen-lockfile', '--ignore-scripts', '--non-interactive'], stage);
rmSync(join(stage, 'yarn.lock'));

run('npx', ['-y', MCPB_CLI, 'validate', join(stage, 'manifest.json')], root);
mkdirSync(dirname(output), { recursive: true });
run('npx', ['-y', MCPB_CLI, 'pack', stage, output], root);

// Check the packed archive itself, not just the staging directory.
const unpacked = mkdtempSync(join(tmpdir(), 'mcp-instagram-mcpb-'));
try {
  run('npx', ['-y', MCPB_CLI, 'unpack', output, unpacked], root);
  const missing = REQUIRED_IN_BUNDLE.filter((entry) => !existsSync(join(unpacked, entry)));
  if (missing.length > 0) {
    console.error(`The bundle is missing: ${missing.join(', ')}`);
    process.exit(1);
  }
} finally {
  rmSync(unpacked, { recursive: true, force: true });
}
console.log(`Wrote ${output}`);
