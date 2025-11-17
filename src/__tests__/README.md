# Testing the MCP Server

This directory contains tests for the Instagram MCP server.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

### Integration Tests (`server.test.ts`)
Tests the MCP server end-to-end by:
- Starting the actual server process
- Communicating via stdio using JSON-RPC
- Testing tool listing and execution
- Verifying error handling

### Unit Tests (`tools.test.ts`)
Tests individual tools in isolation:
- Tool definitions
- Input validation
- Error handling
- Mocked dependencies

## MCP Test Client (`mcp-client.ts`)

The `MCPTestClient` class provides a way to communicate with the MCP server:
- Spawns the server process
- Sends JSON-RPC requests via stdin
- Receives responses via stdout
- Handles timeouts and errors

## Example Usage

```typescript
import { MCPTestClient } from "./mcp-client.js";

const client = new MCPTestClient();
await client.start();

// List available tools
const tools = await client.listTools();

// Call a tool
const result = await client.callTool("instagram_login", {
  username: "test_user",
  password: "test_pass",
});

await client.stop();
```

## Notes

- Integration tests require the project to be built (`npm run build`)
- Tests clean up session files before/after running
- Network-dependent tests have longer timeouts
- Mocked tests don't require actual Instagram credentials

