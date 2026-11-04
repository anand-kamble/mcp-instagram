# Insta MCP Server

MCP (Model Context Protocol) server for Instagram integration.


## Features

- **Comprehensive Access**: View user profiles, timelines, stories, and detailed post information.
- **Smart Engagement**: Like posts, comments, and follow users directly from your MCP client.
- **Search & Discovery**: Powerful search capabilities to find accounts and explore content.
- **Secure login**: Username and password with two-factor prompts (email, SMS or authenticator app), or the session of a browser where you are already logged in.
- **Developer Ready**: Works with Claude Code, Claude Desktop, VS Code, Cursor, and other MCP-compatible clients.

## Requirements

- Node.js 22 or newer (`node --version`). Node 20 reached end-of-life on 2026-04-30.
- An Instagram account. Prefer a secondary account; see the disclaimer below.

## Logging in

There are two ways to log in. Either way, the session is saved privately and reused after restarts, so you only log in once (see [Session storage](#session-storage)).

### Username and password

Set `IG_USERNAME` and `IG_PASSWORD`, as in the client examples below. The server logs in the way the current Instagram Android app does: the password is encrypted with Instagram's public key, sent once, and never written to disk.

If the account uses two-factor authentication, or Instagram wants to confirm a login from a new device, Instagram sends a code by email, SMS or authenticator app. You enter it on a one-time page the server opens on your own machine, so the code never passes through the assistant. See [Two-factor authentication](#two-factor-authentication).

Instagram watches for repeated logins, so the server allows at most one password login per minute (see [Rate limits](#rate-limits)), and a new device may need to be confirmed in the Instagram app the first time.

### Browser session cookie

Instead of a password, you can give the server the session of a browser where you are logged in to Instagram (`IG_SESSION_ID`). No password or two-factor code is involved:

1. Log in to [instagram.com](https://www.instagram.com) in a browser (a private window works).
2. Open the developer tools: **Application** (Chrome, Edge) or **Storage** (Firefox), then **Cookies**, then `https://www.instagram.com`.
3. Copy the value of the `sessionid` cookie. It starts with your numeric user id, followed by `%3A`.
4. Set it as `IG_SESSION_ID` in your MCP client's server configuration, in place of `IG_USERNAME` and `IG_PASSWORD`.
5. Close the tab, but **don't log out** in that browser: logging out ends the session the server is using.

The session cookie gives full access to the account, so treat it like a password. If Instagram ends the session (for example after you log out or change your password), copy a fresh cookie into `IG_SESSION_ID` and restart the server. `instagram_logout` ends the session on Instagram, which also logs out the browser the cookie came from.

When both are configured, `IG_SESSION_ID` is used first.

## Installation for MCP Clients

The server runs locally over stdio and is published on npm, so every client below starts it with `npx -y mcp-instagram`.

### Claude Code

```bash
claude mcp add --env IG_USERNAME=your_username --env IG_PASSWORD=your_password --transport stdio instagram -- npx -y mcp-instagram
```

Keep `--transport stdio` between the last `--env` and the server name; otherwise the name is read as another `KEY=value` pair. Add `--scope user` to make the server available in every project.

`claude mcp add` stores the values in your Claude Code config file in plain text. To keep the password out of config files, put the server in a project `.mcp.json` and reference variables from your shell environment instead:

```json
{
  "mcpServers": {
    "instagram": {
      "command": "npx",
      "args": ["-y", "mcp-instagram"],
      "env": {
        "IG_USERNAME": "${IG_USERNAME}",
        "IG_PASSWORD": "${IG_PASSWORD}"
      }
    }
  }
}
```

### Claude Desktop

**One-click bundle.** Starting with the first release after 0.0.6, each [GitHub release](https://github.com/anand-kamble/mcp-instagram/releases) includes `mcp-instagram-<version>.mcpb`. Open the file (double-click, or drag it into Claude Desktop's **Settings > Extensions**). Claude Desktop asks for your Instagram username and password (or a session cookie, see [Logging in](#logging-in)), masks the secrets, and runs the server with its built-in Node.js, so no separate Node install or JSON editing is needed. To build the bundle yourself: `yarn build && node scripts/pack-mcpb.mjs`.

**Manual configuration:**

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
        "-y",
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

3. **Replace the credentials** with your Instagram username and password, or use `IG_SESSION_ID` instead; see [Logging in](#logging-in).

4. **Restart Claude Desktop** for the changes to take effect.
You should then see the Instagram MCP server in the list of available tools.
<p align="center">
  <img src="./media/claude_install_2.png" alt="Claude Desktop MCP Server Configuration" width="48%" style="display:inline-block; margin-right: 1%;">
  <img src="./media/claude_install_1.png" alt="Claude Desktop MCP Server Configuration" width="48%" style="display:inline-block;">
</p>

### VS Code

Add this to `.vscode/mcp.json` in your workspace. VS Code prompts for the username and password when the server starts and masks the password, so neither is written into the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "ig-username",
      "description": "Instagram username"
    },
    {
      "type": "promptString",
      "id": "ig-password",
      "description": "Instagram password",
      "password": true
    }
  ],
  "servers": {
    "instagram": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-instagram"],
      "env": {
        "IG_USERNAME": "${input:ig-username}",
        "IG_PASSWORD": "${input:ig-password}"
      }
    }
  }
}
```

### Cursor

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
        "-y",
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

3. **Replace the credentials** with your Instagram username and password, or use `IG_SESSION_ID` instead; see [Logging in](#logging-in).

4. **Restart Cursor** for the changes to take effect.

### Running from a local clone

```bash
git clone https://github.com/anand-kamble/mcp-instagram.git
cd mcp-instagram
yarn install --frozen-lockfile
yarn build
```

Then point your client at the built entry point instead of `npx`:

```json
{
  "mcpServers": {
    "mcp-instagram": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-instagram/bin/insta-mcp.js"],
      "env": {
        "IG_USERNAME": "your_instagram_username",
        "IG_PASSWORD": "your_instagram_password"
      }
    }
  }
}
```

## Configuration

All configuration is through environment variables set in your MCP client's server entry.

| Variable | Required | Description |
|---|---|---|
| `IG_USERNAME` | For password login | Instagram username (an email or phone number also works for login). If it is a username, the server also refuses a saved session that belongs to a different account. |
| `IG_PASSWORD` | For password login | Instagram password. Sent once, encrypted, at login; never written to disk. Like any environment variable it stays in the server process's memory. |
| `IG_SESSION_ID` | Instead of a password | The `sessionid` cookie of a logged-in instagram.com browser session; see [Logging in](#logging-in). |
| `IG_SESSION_DIR` | No | Directory for the saved session. Default: `$XDG_CONFIG_HOME/mcp-instagram`, else `~/.config/mcp-instagram` (macOS and Linux), or `%APPDATA%\mcp-instagram` (Windows). Must be owned by you and not writable by other users; the server refuses shared directories such as `/tmp`. |
| `IG_DEBUG_CAPTURE` | No | Diagnostics: a directory where a password login that hits an Instagram screen the server cannot handle saves Instagram's responses (tokens and session ids removed, file mode 0600). Off by default; the files can still contain account details, so delete them after sharing. |
| `IG_RATE_LIMITS` | No | JSON overrides for the write-action limits, for example `{"like":{"perHour":100}}`. See [Rate limits](#rate-limits). |

### Session storage

After a successful login, the server saves the Instagram session (cookies and device identifiers) to `session.json` in the session directory above, so restarts do not require logging in again. Anyone who can read that file can act as your Instagram account, so the server creates the directory with mode `0700` and the file with mode `0600`, and writes it atomically. `instagram_logout` ends the session on Instagram (when Instagram is reachable) and deletes the file.

Versions up to 0.0.6 stored the session in `data/session.json` inside the package directory (under `npx`, that is the npm cache). On first start, the current version moves such a file to the new location and removes the old copy. This happens only when `IG_SESSION_DIR` is not set, and only for the package directory, never the directory your MCP client runs in.

If `IG_USERNAME` is set and the saved session (or `IG_SESSION_ID`) belongs to a different account, the server refuses it. When `IG_SESSION_ID` changes, the server logs in with the new value instead of the saved session. Session files written by earlier versions are converted on first start and keep you logged in.

### Rate limits

Instagram restricts accounts that like, comment or follow in fast bursts, and locks accounts behind a security checkpoint after repeated logins. To keep an agent loop from getting the account blocked, the server limits write actions and logins per process. When a limit is reached, the tool returns an error saying when to retry, and nothing is sent to Instagram.

| Action | Per minute | Per hour | Per day |
|---|---|---|---|
| like / unlike (posts and comments) | 10 | 60 | 500 |
| comment | 3 | 20 | 100 |
| follow / unfollow | 5 | 30 | 150 |
| login (including the automatic login at startup) | 1 | 5 | 10 |

Instagram does not publish its limits, so these defaults are deliberately conservative rather than derived from Instagram's numbers. Override any subset with `IG_RATE_LIMITS`, using the keys `like`, `comment`, `follow`, `login` and `perMinute`, `perHour`, `perDay`. Counters are kept in memory and reset when the server restarts.

### Security Notes

- **Never commit your session cookie or credentials** to version control. Prefer the Claude Code `${VAR}` or VS Code `inputs` setups above over plain-text values in config files.
- Credentials are never requested from the LLM. They come only from environment variables.
- The saved session is a credential too; see [Session storage](#session-storage).
- All Instagram traffic uses verified TLS. The underlying library disables certificate checks by default; this server turns them back on for every request.
- Two-factor codes are the only thing the server ever asks you for, and you type them on a local page, not in the chat. Your password or session cookie come only from its configuration.
- Text in tool results (captions, comments, bios, usernames) is written by other Instagram users. The server tells the assistant to treat it as data, not instructions, but review write actions the assistant proposes.

### Verifying Installation

After restarting your MCP client, the Instagram server should appear in its list of servers. Ask the assistant to log in, then try something like "show me the latest posts from @nasa".

## Tools

Read-only tools return structured JSON (`structuredContent`, described by each tool's `outputSchema`) as well as a text copy. Write tools are marked non-read-only, and every tool declares MCP annotations so clients can decide which calls need confirmation.

| Tool | Title | Kind |
|---|---|---|
| `instagram_login` | Log in to Instagram | write, idempotent |
| `instagram_complete_2fa` | Complete two-factor login | write |
| `instagram_logout` | Log out of Instagram | write, destructive, idempotent |
| `instagram_search_accounts` | Search accounts | read-only |
| `instagram_get_user_profile` | Get user profile | read-only |
| `instagram_get_current_user_profile` | Get current user profile | read-only |
| `instagram_get_user_posts` | Get user posts | read-only, paginated |
| `instagram_get_post_details` | Get post details | read-only |
| `instagram_get_post_comments` | Get post comments | read-only, paginated |
| `instagram_get_user_stories` | Get user stories | read-only |
| `instagram_get_timeline_feed` | Get home timeline | read-only, paginated |
| `instagram_like_post` | Like a post | write, idempotent, rate limited |
| `instagram_like_comment` | Like a comment | write, idempotent, rate limited |
| `instagram_comment_on_post` | Comment on a post | write, rate limited |
| `instagram_follow_user` | Follow a user | write, idempotent, rate limited |

Every tool except login and logout needs an active session. Paginated tools return `nextMaxId` when more items exist; pass it back as `maxId` to get the next page. Instagram decides the page size; `limit` only caps how many items of the current page are returned.

### Two-factor authentication

`instagram_login` takes no arguments and never asks for your password; it uses `IG_USERNAME` and `IG_PASSWORD` (or `IG_SESSION_ID`). If Instagram asks for a verification code, it sends it by email, SMS or authenticator app, and the server says which:

- The server opens a one-time page on your own machine (`http://127.0.0.1:<port>/2fa/...`) where you type the code, so it never passes through the MCP client or the assistant. Clients that support MCP URL elicitation (for example Claude Code in an interactive session) offer to open it in your browser; in other clients the assistant gives you the link. The page accepts one code, expires after 10 minutes, and closes when you log out or start a new login. A malformed code can be corrected on the page; a code Instagram rejects ends the attempt, and calling `instagram_login` again starts a new one.
- If you cannot open the page, tell the assistant the code and it calls `instagram_complete_2fa` with it (the code then passes through the conversation). If you decline the prompt to open the page, the login stops and the assistant is told not to ask again.

If a login is already waiting for a code (for example from the automatic login at startup), `instagram_login` reuses it rather than sending your password again. With `IG_SESSION_ID`, two-factor authentication already happened in the browser, so no code is needed.

## ⚠️ Legal Disclaimer and Risks

**IMPORTANT: READ BEFORE USE**

This software utilizes unofficial Instagram API access methods and is not affiliated with, endorsed by, or supported by Meta Platforms, Inc. (Instagram). By using this MCP server, you acknowledge and agree to the following:

### Risks and Limitations

1. **Account Restrictions:** Use of this software may result in your Instagram account being flagged for suspicious or automated activity. Instagram may issue warnings, temporarily restrict account functionality, or permanently suspend or delete your account.

2. **No Guarantees:** The functionality of this software is not guaranteed and may cease to work at any time due to changes in Instagram's platform, security measures, or policies. It talks to Instagram's private mobile API through its own client (a TypeScript port of parts of [instagrapi](https://github.com/subzeroid/instagrapi), see `NOTICE`). Instagram changes that API without notice, so tools can stop working until the client is updated.

### Limitation of Liability

THE AUTHOR(S) AND CONTRIBUTOR(S) OF THIS SOFTWARE PROVIDE IT "AS IS" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. IN NO EVENT SHALL THE AUTHOR(S) BE HELD LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OF THE SOFTWARE, INCLUDING BUT NOT LIMITED TO:

- Instagram account suspensions, restrictions, or deletions
- Loss of data, content, or access to Instagram services
- Any direct, indirect, incidental, special, consequential, or punitive damages

**BY USING THIS SOFTWARE, YOU ACCEPT FULL RESPONSIBILITY FOR ANY CONSEQUENCES THAT MAY RESULT FROM ITS USE. USE AT YOUR OWN RISK.**

### Recommendations

- Use a secondary or test Instagram account rather than your primary account
- Monitor your account for any warnings or unusual activity
- Keep the built-in [rate limits](#rate-limits) at or below their defaults to minimize detection risk
- Regularly review Instagram's Terms of Service and comply with all applicable laws and regulations

**TL;DR:** It's just common sense, really. Don't go liking 10,000 posts in an hour or following everyone on the planet. Instagram doesn't like robots pretending to be humans. Be cool, don't overdo it, and you'll probably be fine. Probably.

