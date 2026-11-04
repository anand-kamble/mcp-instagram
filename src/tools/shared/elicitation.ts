/**
 * Client capability checks for elicitation.
 */

import { CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/server";
import type { ClientCapabilities, McpServer, ServerContext } from "@modelcontextprotocol/server";

/**
 * Whether the client calling this tool supports URL-mode elicitation (it can
 * open a URL for the user so a secret goes straight to the server). Unlike
 * form mode there is no pre-mode default: `url` must be declared.
 */
export function clientSupportsUrlElicitation(server: McpServer, ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities =
    (envelope?.[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined) ??
    server.server.getClientCapabilities();
  const elicitation = capabilities?.elicitation as Record<string, unknown> | undefined;
  return Boolean(elicitation && "url" in elicitation);
}
