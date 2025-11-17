#!/usr/bin/env node

/**
 * Entry point for npx execution
 * This script handles building and running the MCP server
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const buildPath = join(projectRoot, 'build', 'server.js');

// Check if build exists, if not, try to build
if (!existsSync(buildPath)) {
  console.error('Build not found. Building project...');
  const buildProcess = spawn('npm', ['run', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
  });

  buildProcess.on('exit', (code) => {
    if (code !== 0) {
      console.error('Build failed. Please run "npm run build" manually.');
      process.exit(1);
    }
    // After build, run the server
    runServer();
  });
} else {
  runServer();
}

function runServer() {
  // Spawn the server process
  const serverProcess = spawn('node', [buildPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
  });

  serverProcess.on('exit', (code) => {
    process.exit(code || 0);
  });

  serverProcess.on('error', (error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

