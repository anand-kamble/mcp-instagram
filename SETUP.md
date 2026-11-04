# Setting Up Insta MCP Server in Cursor/Claude Desktop

## Prerequisites

Node.js 22 or newer.

1. **Install dependencies:**
   ```bash
   yarn install --frozen-lockfile
   ```

2. **Build the project:**
   ```bash
   yarn build
   ```

## Configuration

### For Cursor (Current Setup)

The MCP configuration file is located at `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your workspace).

Add the following configuration to your `mcpServers` object:

**Option 1: Using npx (Recommended)**
```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "npx",
      "args": [
        "/absolute/path/to/mcp-instagram"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

**Option 2: Using node directly**
```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-instagram/build/server.js"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

**Note:** Replace `/absolute/path/to/mcp-instagram` with the absolute path to your project directory.

### For Claude Desktop

The configuration file location depends on your OS:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add the following to the `mcpServers` section:

**Option 1: Using npx (Recommended)**
```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "npx",
      "args": [
        "/absolute/path/to/mcp-instagram"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

**Option 2: Using node directly**
```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-instagram/build/server.js"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

**Important:** 
- Use absolute paths (not relative paths)
- Replace `/absolute/path/to/mcp-instagram` with your actual project path
- Make sure Node.js is in your PATH, or use the full path to node (e.g., `/Users/you/.nvm/versions/node/v24.11.0/bin/node`)

## Environment Variables (Optional)

Instead of hardcoding credentials in the config, you can use environment variables. The server will automatically load from:
- Environment variables: `IG_USERNAME`, `IG_PASSWORD`, plus the optional `IG_SESSION_DIR` and `IG_RATE_LIMITS` (see the Configuration section of README.md)
- Or set them in the `env` section of the MCP config (as shown above)

## Verifying the Setup

1. **Restart Cursor/Claude Desktop** after updating the configuration
2. The server should automatically start when you use MCP features
3. Check the server logs in Cursor's MCP panel or Claude Desktop's developer console

## Troubleshooting

### Server not starting
- Verify the path to `build/server.js` is correct and absolute
- Ensure the project has been built (`yarn build`)
- Check that Node.js is accessible from the PATH

### Authentication errors
- Verify your Instagram credentials are correct
- Check if 2FA is enabled (the server supports 2FA)
- Ensure environment variables are set correctly

### Session persistence
- Sessions are saved to `session.json` in `~/.config/mcp-instagram/` (macOS/Linux) or `%APPDATA%\mcp-instagram\` (Windows), or in `IG_SESSION_DIR` if set
- Use the `instagram_logout` tool, or delete this file, to force a new login

