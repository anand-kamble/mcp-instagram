/**
 * Integration tests for MCP server
 */

import { MCPTestClient } from "./mcp-client.js";
import { promises as fs } from "fs";
import { join } from "path";

describe("MCP Server Integration Tests", () => {
  let client: MCPTestClient;
  const sessionFile = join(process.cwd(), "data", "session.json");

  beforeAll(async () => {
    client = new MCPTestClient();
    await client.start();
    
    // Clean up any existing session before tests
    try {
      await fs.unlink(sessionFile);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  afterAll(async () => {
    await client.stop();
    
    // Clean up session after tests
    try {
      await fs.unlink(sessionFile);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe("Server Connection", () => {
    it("should start the server successfully", () => {
      expect(client).toBeDefined();
    });
  });

  describe("Tools List", () => {
    it("should list available tools", async () => {
      const tools = await client.listTools();
      
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      // Check for expected tools
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("instagram_login");
      expect(toolNames).toContain("instagram_complete_2fa");
    });

    it("should return tool definitions with correct structure", async () => {
      const tools = await client.listTools();
      const loginTool = tools.find((t) => t.name === "instagram_login");
      
      expect(loginTool).toBeDefined();
      expect(loginTool).toHaveProperty("name");
      expect(loginTool).toHaveProperty("description");
      expect(loginTool).toHaveProperty("inputSchema");
      expect(loginTool.inputSchema).toHaveProperty("type", "object");
      expect(loginTool.inputSchema).toHaveProperty("properties");
    });
  });

  describe("Login Tool", () => {
    it("should require username and password", async () => {
      const result = await client.callTool("instagram_login", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("required");
    });

    it("should reject invalid credentials gracefully", async () => {
      const result = await client.callTool("instagram_login", {
        username: "invalid_user_test_12345",
        password: "invalid_password_test_12345",
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      
      // Should return an error or indicate failure
      const text = result.content[0]?.text || "";
      expect(text.length).toBeGreaterThan(0);
    }, 30000); // Longer timeout for network requests
  });

  describe("Complete 2FA Tool", () => {
    it("should require verification code", async () => {
      const result = await client.callTool("instagram_complete_2fa", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("required");
    });

    it("should reject 2FA completion without pending login", async () => {
      const result = await client.callTool("instagram_complete_2fa", {
        verification_code: "123456",
      });

      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
      
      const text = result.content[0]?.text || "";
      expect(text.toLowerCase()).toContain("pending");
    });
  });

  describe("Tool Error Handling", () => {
    it("should handle unknown tool gracefully", async () => {
      await expect(
        client.callTool("unknown_tool", {})
      ).rejects.toThrow();
    });

    it("should validate tool input schema", async () => {
      // Missing required password
      const result = await client.callTool("instagram_login", {
        username: "test_user",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("required");
    });
  });
});

