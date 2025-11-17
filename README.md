# Insta MCP Server

> **⚠️ This project is currently under active development. Features may change, and the API is not yet stable. Use at your own risk.**

MCP (Model Context Protocol) server for Instagram integration.


## Quick Start from GitHub

### Option 1: Clone and Run with npx (Recommended)

```bash
# Clone the repository
git clone https://github.com/anand-kamble/mcp-instagram.git
cd mcp-instagram

# Install dependencies
npm install

# Run with npx (automatically builds if needed)
npx mcp-instagram
```

### Option 2: One-liner with npx (after cloning)

```bash
git clone https://github.com/anand-kamble/mcp-instagram.git && \
cd mcp-instagram && \
npm install && \
npx mcp-instagram
```

### Option 3: Direct npx from GitHub (if published to npm)

Once published to npm, you can run directly:
```bash
npx mcp-instagram
```

## Installation for MCP Clients

This MCP server can be used with MCP-compatible clients like Claude Desktop and Cursor IDE. Follow the instructions below to configure the server in your client.

### Prerequisites

- Node.js 18+ or 20+ installed
- Instagram account credentials (`IG_USERNAME` and `IG_PASSWORD`)

### For Claude Desktop

1. **Locate your Claude Desktop configuration file:**
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux:** `~/.config/Claude/claude_desktop_config.json`

2. **Open the configuration file** (create it if it doesn't exist) and add the following to the `mcpServers` section:

```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "npx",
      "args": [
        "mcp-instagram"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

3. **Replace the credentials:**
   - Replace `your_instagram_username` with your Instagram username
   - Replace `your_instagram_password` with your Instagram password

4. **Restart Claude Desktop** for the changes to take effect.

### For Cursor IDE

1. **Locate your Cursor MCP configuration file:**
   - Workspace config: `.cursor/mcp.json` (in your project root)
   - Global config: `~/.cursor/mcp.json`

2. **Open the configuration file** (create it if it doesn't exist) and add the following to the `mcpServers` section:

```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "npx",
      "args": [
        "mcp-instagram"
      ],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

3. **Replace the credentials:**
   - Replace `your_instagram_username` with your Instagram username
   - Replace `your_instagram_password` with your Instagram password

4. **Restart Cursor** for the changes to take effect.

### Alternative: Using Local Installation

If you've cloned the repository locally, you can use the absolute path instead:

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

**Note:** Replace `/absolute/path/to/mcp-instagram` with the actual absolute path to your cloned repository.

### Security Notes

- **Never commit your credentials** to version control
- The `env` section in the MCP configuration is the recommended way to provide credentials
- Credentials are never requested from the LLM - they must be provided via environment variables
- If you have 2FA enabled on your Instagram account, you'll need to complete the 2FA flow using the `instagram_complete_2fa` tool after initial login

### Verifying Installation

After restarting your MCP client, you should see the Instagram MCP server in the list of available servers. You can verify it's working by asking the AI assistant to use Instagram tools like:
- `instagram_login` - Login to Instagram
- `instagram_logout` - Logout from Instagram
- `instagram_search_accounts` - Search for Instagram accounts

