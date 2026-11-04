/**
 * Client capability checks for elicitation.
 */

import { CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/server";
import type { ClientCapabilities, McpServer, ServerContext } from "@modelcontextprotocol/server";

/**
 * Whether the client calling this tool can render a form-mode elicitation.
 *
 * On 2026-07-28 requests the capabilities travel in each request's `_meta`
 * envelope; on 2025-era connections they were declared once in
 * `initialize`. A bare `elicitation: {}` predates the form/url split and
 * means form support.
 *
 * The spec forbids sending an elicitation to a client that did not declare
 * support, and on 2026-07-28 the SDK answers such a request with a `-32021`
 * protocol error rather than a tool result, so tools must check first and
 * use a text flow otherwise.
 */
export function clientSupportsFormElicitation(server: McpServer, ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities =
    (envelope?.[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined) ??
    server.server.getClientCapabilities();
  const elicitation = capabilities?.elicitation as Record<string, unknown> | undefined;
  if (!elicitation) {
    return false;
  }
  return "form" in elicitation || !("url" in elicitation);
}
