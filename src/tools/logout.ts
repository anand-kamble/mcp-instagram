/**
 * instagram_logout: ends the session on Instagram and deletes the saved session.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { igpapiClient } from "../igpapi/index.js";
import { pendingStartup, waitForStartup, withTimeout } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";

/** Upper bound for the best-effort server-side logout request. */
const REVOKE_TIMEOUT_MS = 10_000;

/**
 * Ends the session on Instagram (best effort) and clears all local state.
 * Returns whether Instagram confirmed the logout.
 */
async function endSession(): Promise<boolean> {
  let revoked = false;
  if (igpapiClient.isLoggedIn()) {
    // Deleting the file alone leaves the cookies valid on Instagram. Offline
    // or an already-dead session must not block the local logout.
    try {
      revoked = (await withTimeout(igpapiClient.getClient().account.logout(), REVOKE_TIMEOUT_MS)).done;
    } catch {
      revoked = false;
    }
  }
  // Always clear local state: a session file that failed to load, or a
  // pending two-factor login, must not survive a logout.
  await igpapiClient.logout();
  return revoked;
}

export function registerLogout(server: McpServer): void {
  server.registerTool(
    "instagram_logout",
    {
      title: "Log out of Instagram",
      description:
        "Log out of Instagram: end the session on Instagram's side (best effort) and delete the saved session " +
        "file. After this, instagram_login must be called before any other Instagram tool works.",
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      await waitForStartup();
      const wasLoggedIn = igpapiClient.isLoggedIn();
      const username = igpapiClient.getUsername();
      const revoked = await endSession();

      // If startup restore/auto-login is still running (tools stop waiting for
      // it after a while), it could finish after this logout and save a fresh
      // session. Undo that when it settles.
      const startup = pendingStartup();
      if (startup) {
        void startup.then(() => endSession()).catch(() => undefined);
      }

      if (!wasLoggedIn) {
        return textResult(
          "There was no active Instagram session. Any saved session file and pending two-factor login were cleared."
        );
      }
      const who = username ? ` (@${username})` : "";
      return textResult(
        revoked
          ? `Logged out of Instagram${who}. The session was ended on Instagram and the saved session file was deleted.`
          : `Logged out of Instagram${who}. The saved session file was deleted, but Instagram could not be reached to end the session there.`
      );
    }
  );
}
