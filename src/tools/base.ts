/**
 * Base tool interface and utilities
 */

import type { ToolDefinition, ToolResult } from "../types/index.js";
import { handleError } from "../utils/index.js";

export abstract class BaseTool {
  abstract getDefinition(): ToolDefinition;

  abstract execute(args: Record<string, any>): Promise<ToolResult>;

  /**
   * Wrap tool execution with error handling
   */
  async executeWithErrorHandling(args: Record<string, any>): Promise<ToolResult> {
    try {
      return await this.execute(args);
    } catch (error) {
      const errorInfo = handleError(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorInfo.message}${errorInfo.details ? `\nDetails: ${JSON.stringify(errorInfo.details, null, 2)}` : ""}`,
          },
        ],
        isError: true,
      };
    }
  }
}

