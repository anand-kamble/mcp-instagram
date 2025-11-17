# Tools Directory

This directory contains all Instagram MCP tools organized by functionality.

## Structure

- `base.ts` - Base tool class that all tools should extend
- `example.ts` - Example tool template showing the pattern
- `index.ts` - Tools registry that exports all tools for the server

## Creating a New Tool

1. Create a new file (e.g., `get_profile.ts`)
2. Extend `BaseTool` class
3. Implement `getDefinition()` and `execute()` methods
4. Add the tool instance to `tools/index.ts` array

Example:

```typescript
import { BaseTool } from "./base.js";
import type { ToolDefinition, ToolResult } from "../types/index.js";
import { igpapiClient } from "../igpapi/index.js";

export class GetProfileTool extends BaseTool {
  getDefinition(): ToolDefinition {
    return {
      name: "get_profile",
      description: "Get Instagram profile information",
      inputSchema: {
        type: "object",
        properties: {
          username: {
            type: "string",
            description: "Instagram username",
          },
        },
        required: ["username"],
      },
    };
  }

  async execute(args: { username: string }): Promise<ToolResult> {
    const client = igpapiClient.getClient();
    // Implement your logic here
    return {
      content: [{ type: "text", text: "Profile data..." }],
    };
  }
}
```

## Tool Categories (Future Organization)

Consider organizing tools into subdirectories:
- `posts/` - Post-related tools (create, edit, delete, get)
- `stories/` - Story-related tools
- `messages/` - Direct message tools
- `profile/` - Profile management tools
- `media/` - Media upload/download tools
- `engagement/` - Like, comment, follow tools

