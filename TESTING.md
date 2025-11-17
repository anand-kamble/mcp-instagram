# Testing the MCP Server

You can test your MCP server in two ways:

## Method 1: Manual Test Script (Quick & Simple)

The simplest way to test without installing Jest:

```bash
npm run test:manual
```

This will:
1. Build the project
2. Start the server
3. Run basic integration tests
4. Show you the JSON-RPC communication

You can also run it directly:
```bash
npm run build
node build/test-manual.js
```

## Method 2: Jest Test Suite (Full Testing)

For comprehensive testing with Jest:

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Structure

- **`src/__tests__/mcp-client.ts`** - MCP client utility for communicating with server
- **`src/__tests__/server.test.ts`** - Integration tests (spawns actual server)
- **`src/__tests__/tools.test.ts`** - Unit tests for individual tools (mocked)

### What Gets Tested

#### Integration Tests (`server.test.ts`)
- Server startup and connection
- Tool listing
- Tool execution
- Error handling
- Input validation

#### Unit Tests (`tools.test.ts`)
- Tool definitions
- Parameter validation
- 2FA flow handling
- Error scenarios

## How It Works

The test client (`MCPTestClient`) communicates with your server using JSON-RPC 2.0 over stdio:

1. **Spawns the server process** - Runs `node build/server.js`
2. **Sends JSON-RPC requests** - Writes to server's stdin
3. **Receives responses** - Reads from server's stdout
4. **Handles timeouts** - Prevents hanging tests

## Example: Writing Your Own Test

```typescript
import { MCPTestClient } from "./mcp-client.js";

const client = new MCPTestClient();
await client.start();

// List tools
const tools = await client.listTools();
console.log("Available tools:", tools.map(t => t.name));

// Call a tool
const result = await client.callTool("instagram_login", {
  username: "test_user",
  password: "test_pass",
});

console.log("Result:", result);

await client.stop();
```

## Testing Without Real Instagram Credentials

The tests are designed to work without real Instagram credentials:
- Integration tests use invalid credentials (expected to fail gracefully)
- Unit tests use mocks to avoid actual API calls
- Session files are cleaned up before/after tests

## Troubleshooting

### "Cannot find module" errors
Run `npm install` to install Jest and dependencies.

### Tests timeout
- Check that the server builds successfully (`npm run build`)
- Ensure Node.js is in your PATH
- Increase timeout in test files if needed

### Server won't start
- Verify `build/server.js` exists
- Check that all dependencies are installed
- Look at server stderr output for errors

## Next Steps

1. Add more test cases for your specific tools
2. Test edge cases and error scenarios
3. Add integration tests with real credentials (optional, be careful!)
4. Set up CI/CD to run tests automatically

