/**
 * Helpers for building CallToolResult values.
 */

import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Result for tools that declare an `outputSchema`.
 *
 * The spec requires conforming `structuredContent` and says the server SHOULD
 * also return the serialized JSON in a text block for clients that only read
 * `content`.
 */
export function structuredResult<T extends Record<string, unknown>>(data: T): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

/** Plain text result for tools without an `outputSchema`. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}
