# Installation Guide

## Running from GitHub Repository

The repository is available at: https://github.com/anand-kamble/mcp-instagram

### Method 1: Clone and Use npx (Recommended)

```bash
# Clone the repository
git clone https://github.com/anand-kamble/mcp-instagram.git
cd mcp-instagram

# Install dependencies and build (Node.js 22 or newer)
yarn install --frozen-lockfile
yarn build

# Run the server over stdio
node bin/insta-mcp.js
```

### Method 2: Run the clone from anywhere

After cloning and building, you can run it from any directory:

```bash
node /absolute/path/to/mcp-instagram/bin/insta-mcp.js
```

### Method 3: Traditional npm Scripts

```bash
git clone https://github.com/anand-kamble/mcp-instagram.git
cd mcp-instagram
yarn install --frozen-lockfile
yarn build
yarn start
```

## Publishing to npm (For Global npx Access)

### Automated Publishing with GitHub Actions (Recommended)

The repository includes a GitHub Actions workflow that automatically publishes to npm when you create a release.

#### Setup Steps:

1. **Create npm account** (if you don't have one): https://www.npmjs.com/signup

2. **Create npm access token**:
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Click "Generate New Token"
   - Select "Automation" token type
   - Copy the token

3. **Add token to GitHub Secrets**:
   - Go to your repository: https://github.com/anand-kamble/mcp-instagram
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Paste your npm token
   - Click "Add secret"

4. **Create a GitHub Release**:
   - Go to your repository → Releases → "Create a new release"
   - Tag version: `v1.0.0` (or any version)
   - Release title: `v1.0.0`
   - Click "Publish release"
   - The GitHub Action will automatically publish to npm, with a provenance attestation linking the package to the workflow run, and attach a Claude Desktop bundle (`mcp-instagram-<version>.mcpb`) with its own build attestation to the release.
   - Pushing a `v<version>` tag (for example `git tag v0.1.0 && git push origin v0.1.0`) does the same and creates the GitHub release if it does not exist yet. The tag must be plain semver after the `v`.

#### Manual Publishing (Alternative)

If you prefer to publish manually:

1. **Login to npm**:
   ```bash
   npm login
   ```

2. **Update version** (if needed):
   ```bash
   npm version patch  # or minor, major
   ```

3. **Publish the package**:
   ```bash
   yarn build
   npm publish --access public
   ```

4. **After publishing**, anyone can run:
   ```bash
   npx mcp-instagram
   ```

   Or install globally:
   ```bash
   npm install -g mcp-instagram
   mcp-instagram
   ```

## Publishing to the MCP Registry

The server is described for the [MCP Registry](https://registry.modelcontextprotocol.io) by `server.json` in the repository root. The registry verifies npm packages by reading `mcpName` from the published `package.json`, so publish to npm first.

1. Keep the versions in sync: `version` in `package.json`, and both `version` fields in `server.json`, must match the npm release.
2. Install the publisher CLI (see https://modelcontextprotocol.io/registry/quickstart), then run:
   ```bash
   mcp-publisher login github
   mcp-publisher publish
   ```

The registry is still in preview, so check the quickstart for changes before publishing.

## Configuration for MCP Clients

### For Cursor IDE

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-instagram/bin/insta-mcp.js"
      ],
      "env": {
        "IG_SESSION_ID": "your_sessionid_cookie"
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
    "mcp-instagram": {
      "command": "node",
      "args": [
        "/absolute/path/to/mcp-instagram/bin/insta-mcp.js"
      ],
      "env": {
        "IG_SESSION_ID": "your_sessionid_cookie"
      }
    }
  }
}
```

## Environment Variables

You can set environment variables instead of using the config file:

```bash
export IG_SESSION_ID="your_sessionid_cookie"
npx mcp-instagram
```

## Troubleshooting

### Build Errors

If you encounter build errors, ensure you have the correct Node.js version:
```bash
node --version  # Should be v22 or newer
```

### Permission Errors

If you get permission errors with npx:
```bash
# Make sure the bin script is executable
chmod +x bin/insta-mcp.js
```

### Module Not Found

If you see module errors, ensure dependencies are installed and the project is built:
```bash
yarn install --frozen-lockfile
yarn build
```

