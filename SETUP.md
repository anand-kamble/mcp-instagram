# Setting Up Insta MCP Server in Cursor/Claude Desktop

## Prerequisites

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

## Configuration

### For Cursor (Current Setup)

The MCP configuration file is located at `~/.cursor/mcp.json` (or `.cursor/mcp.json` in your workspace).

Add the following configuration to your `mcpServers` object:

```json
{
  "mcpServers": {
    "insta-mcp": {
      "command": "node",
      "args": [
        "/home/iunme/insta-mcp/build/server.js"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

**Note:** Replace `/home/iunme/insta-mcp` with the absolute path to your project directory.

### For Claude Desktop

The configuration file location depends on your OS:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add the following to the `mcpServers` section:

```json
{
  "mcpServers": {
    "insta-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/insta-mcp/build/server.js"
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
- Replace `/absolute/path/to/insta-mcp` with your actual project path
- Make sure Node.js is in your PATH, or use the full path to node (e.g., `/home/iunme/.nvm/versions/node/v24.11.0/bin/node`)

## Environment Variables (Optional)

Instead of hardcoding credentials in the config, you can use environment variables. The server will automatically load from:
- Environment variables: `IG_USERNAME`, `IG_PASSWORD`, `IG_SESSION_ID`, `IG_DEVICE_ID`
- Or set them in the `env` section of the MCP config (as shown above)

## Verifying the Setup

1. **Restart Cursor/Claude Desktop** after updating the configuration
2. The server should automatically start when you use MCP features
3. Check the server logs in Cursor's MCP panel or Claude Desktop's developer console

## Troubleshooting

### Server not starting
- Verify the path to `build/server.js` is correct and absolute
- Ensure the project has been built (`npm run build`)
- Check that Node.js is accessible from the PATH

### Authentication errors
- Verify your Instagram credentials are correct
- Check if 2FA is enabled (the server supports 2FA)
- Ensure environment variables are set correctly

### Session persistence
- Sessions are saved to `data/session.json` in the project directory
- Delete this file if you need to force a new login

