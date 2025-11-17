import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getAllToolDefinitions,
  executeTool,
} from "./tools/index.js";
import { loadConfigFromEnv, setConfig } from "./config/index.js";
import { igpapiClient } from "./igpapi/index.js";

const server = new Server(
  {
    name: "insta-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Load configuration from environment variables
const envConfig = loadConfigFromEnv();
setConfig(envConfig);

// Initialize IGPAPI client and try to restore session
igpapiClient
  .initialize()
  .then(async () => {
    if (igpapiClient.isLoggedIn()) {
      console.error("IGPAPI session restored successfully");
    } else {
      // If no session but credentials are provided, attempt automatic login
      if (envConfig.igpapi?.username && envConfig.igpapi?.password) {
        try {
          await igpapiClient.login(envConfig.igpapi.username, envConfig.igpapi.password);
          console.error("IGPAPI automatic login successful");
        } catch (error) {
          // If 2FA is required, user will need to use the login tool
          if (error && typeof error === "object" && "verificationMethod" in error) {
            console.error("IGPAPI login requires 2FA. Please use the instagram_login tool.");
          } else {
            console.error("IGPAPI automatic login failed:", error instanceof Error ? error.message : String(error));
          }
        }
      } else {
        console.error("IGPAPI client initialized. No active session found. Use instagram_login tool to authenticate.");
      }
    }
  })
  .catch((error) => {
    console.error("Failed to initialize IGPAPI client:", error);
  });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const toolDefinitions = getAllToolDefinitions();
  
  return {
    tools: toolDefinitions.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    })),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const result = await executeTool(name, args || {});

  return {
    content: result.content,
    isError: result.isError,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Insta MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

