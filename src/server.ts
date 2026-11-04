/**
 * stdio entry point.
 *
 * serveStdio answers both protocol eras from the same factory: 2025-era
 * clients that open with `initialize` and 2026-07-28 clients that send
 * per-request `_meta` with `server/discover`.
 */

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfigFromEnv, setConfig } from "./config/index.js";
import { igpapiClient } from "./igpapi/index.js";
import { createServer, serverVersion } from "./mcp.js";
import { setStartupPromise } from "./tools/shared/instagram.js";

// stdout carries the protocol; all logging goes to stderr.
const log = (...args: unknown[]) => console.error("[mcp-instagram]", ...args);

async function restoreOrLogin(): Promise<void> {
  const config = loadConfigFromEnv();
  setConfig(config);

  // initialize() restores the saved session, or imports IG_SESSION_ID.
  await igpapiClient.initialize();
  if (igpapiClient.isLoggedIn()) {
    log("Instagram session ready.");
    return;
  }

  // IG_SESSION_ID was configured but could not be used (initialize logged
  // why). Don't fall back to a password login here: it would spend the login
  // rate limit that instagram_login needs to retry with a fresh cookie.
  if (config.igpapi?.sessionId) {
    log("Not logged in: IG_SESSION_ID was not accepted. Copy a fresh sessionid cookie into IG_SESSION_ID and restart.");
    return;
  }

  const username = config.igpapi?.username;
  const password = config.igpapi?.password;
  if (!username || !password) {
    log(
      "Not logged in: set IG_SESSION_ID to the sessionid cookie from a browser logged in to instagram.com " +
        "(or IG_USERNAME/IG_PASSWORD), then restart or call the instagram_login tool."
    );
    return;
  }

  try {
    await igpapiClient.login(username, password);
    log("Logged in to Instagram from environment credentials.");
  } catch (error) {
    if (error && typeof error === "object" && "verificationMethod" in error) {
      log("Instagram requires two-factor authentication. Call the instagram_login tool to complete it.");
    } else {
      log("Automatic login failed:", error instanceof Error ? error.message : String(error));
    }
  }
}

setStartupPromise(
  restoreOrLogin().catch((error) => {
    log("Failed to initialise the Instagram client:", error instanceof Error ? error.message : String(error));
  })
);

serveStdio(createServer, {
  onerror: (error) => log("Transport error:", error.message),
});
log(`v${serverVersion} running on stdio`);
