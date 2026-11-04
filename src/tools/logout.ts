/**
 * instagram_logout: deletes the saved session.
 */

import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { igpapiClient } from "../igpapi/index.js";
import { waitForStartup } from "./shared/instagram.js";
import { textResult } from "./shared/results.js";

export function registerLogout(server: McpServer): void {
  server.registerTool(
    "instagram_logout",
    {
      title: "Log out of Instagram",
      description:
        "Log out of Instagram and delete the saved session file. After this, instagram_login must be called " +
        "before any other Instagram tool works.",
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
      if (!igpapiClient.isLoggedIn()) {
        return textResult("Already logged out. There is no saved session to delete.");
      }
      let username: string | undefined;
      try {
        username = (await igpapiClient.getCurrentUser()).username;
      } catch {
        // The confirmation message is best-effort; log out regardless.
      }
      await igpapiClient.logout();
      return textResult(
        `Logged out of Instagram${username ? ` (@${username})` : ""}. The saved session was deleted.`
      );
    }
  );
}
