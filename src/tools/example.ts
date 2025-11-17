/**
 * Example tool implementation
 * This serves as a template for creating new tools
 */

import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class ExampleTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "example_tool",
      description: "Example tool template for Instagram operations",
      inputSchema: {
        type: "object",
        properties: {
          param1: {
            type: "string",
            description: "Example parameter",
          },
        },
        required: ["param1"],
      },
    };
  }

  async execute(args: { param1: string }): Promise<ToolResult> {
    // Ensure IGPAPI client is initialized
    if (!igpapiClient.isInitialized()) {
      throw new Error("IGPAPI client not initialized");
    }

    const client = igpapiClient.getClient();

    // TODO: Implement tool logic using IGPAPI client
    // Example:
    // const result = await client.someMethod(args.param1);

    return {
      content: [
        {
          type: "text",
          text: `Example tool executed with param1: ${args.param1}`,
        },
      ],
    };
  }
}

