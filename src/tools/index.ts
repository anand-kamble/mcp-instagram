/**
 * Tools registry
 * Import and export all tools here for easy registration
 */

import { ExampleTool } from "./example.js";
import { LoginTool } from "./login.js";
import { Complete2FATool } from "./complete_2fa.js";
import type { BaseTool } from "./base.js";

// Import all tools
const tools: BaseTool[] = [
  new LoginTool(),
  new Complete2FATool(),
  new ExampleTool(),
  // Add more tools here as you create them
];

/**
 * Get all tool definitions for MCP server registration
 */
export function getAllToolDefinitions() {
  return tools.map((tool) => tool.getDefinition());
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const tool = tools.find((t) => t.getDefinition().name === name);

  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return await tool.executeWithErrorHandling(args);
}

/**
 * Get all registered tool names
 */
export function getToolNames(): string[] {
  return tools.map((tool) => tool.getDefinition().name);
}

