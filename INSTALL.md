# Installation Guide

## Running from GitHub Repository

The repository is available at: https://github.com/anand-kamble/mcp-instagram

### Method 1: Clone and Use npx (Recommended)

```bash
# Clone the repository
git clone https://github.com/anand-kamble/mcp-instagram.git
cd mcp-instagram

# Install dependencies
npm install

# Run with npx (builds automatically if needed)
npx insta-mcp
```

### Method 2: Using npx with Local Path

After cloning, you can run from anywhere:

```bash
# From any directory
npx /absolute/path/to/mcp-instagram
```

### Method 3: Traditional npm Scripts

```bash
git clone https://github.com/anand-kamble/mcp-instagram.git
cd mcp-instagram
npm install
npm run build
npm start
```

## Publishing to npm (For Global npx Access)

To enable `npx insta-mcp` from anywhere without cloning:

1. **Create npm account** (if you don't have one): https://www.npmjs.com/signup

2. **Login to npm**:
   ```bash
   npm login
   ```

3. **Publish the package**:
   ```bash
   npm publish
   ```

4. **After publishing**, anyone can run:
   ```bash
   npx insta-mcp
   ```

   Or install globally:
   ```bash
   npm install -g insta-mcp
   insta-mcp
   ```

## Configuration for MCP Clients

### For Cursor IDE

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "insta-mcp": {
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

### For Claude Desktop

Add to your Claude Desktop config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "insta-mcp": {
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

## Environment Variables

You can set environment variables instead of using the config file:

```bash
export IG_USERNAME="your_instagram_username"
export IG_PASSWORD="your_instagram_password"
npx insta-mcp
```

## Troubleshooting

### Build Errors

If you encounter build errors, ensure you have the correct Node.js version:
```bash
node --version  # Should be 18+ or 20+
```

### Permission Errors

If you get permission errors with npx:
```bash
# Make sure the bin script is executable
chmod +x bin/insta-mcp.js
```

### Module Not Found

If you see module errors, ensure dependencies are installed:
```bash
npm install
```

