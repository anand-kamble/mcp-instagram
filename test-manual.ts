/**
 * Manual test script for MCP server
 * Run with: npx tsx test-manual.ts
 * Or compile and run: npm run build && node build/test-manual.js
 */

import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: any;
}

class SimpleMCPClient {
  private serverProcess: any;
  private requestId = 0;
  private messageBuffer = "";

  async start() {
    return new Promise<void>((resolve) => {
      const serverPath = join(__dirname, "build/server.js");
      
      this.serverProcess = spawn("node", [serverPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, IG_USERNAME: "", IG_PASSWORD: "" },
      });

      this.serverProcess.stdout?.on("data", (data: Buffer) => {
        this.messageBuffer += data.toString();
        this.processMessages();
      });

      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes("Insta MCP server running")) {
          setTimeout(resolve, 500);
        }
      });

      setTimeout(resolve, 2000);
    });
  }

  private processMessages() {
    const lines = this.messageBuffer.split("\n");
    this.messageBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          console.log("📥 Response:", JSON.stringify(response, null, 2));
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }

  async request(method: string, params?: any): Promise<any> {
    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    console.log(`📤 Request: ${method}`, params ? JSON.stringify(params, null, 2) : "");

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout"));
      }, 10000);

      const handler = (data: Buffer) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line);
              if (response.id === id) {
                clearTimeout(timeout);
                this.serverProcess.stdout?.removeListener("data", handler);
                if (response.error) {
                  reject(new Error(response.error.message));
                } else {
                  resolve(response.result);
                }
              }
            } catch (e) {
              // Continue
            }
          }
        }
      };

      this.serverProcess.stdout?.on("data", handler);
      this.serverProcess.stdin?.write(JSON.stringify(request) + "\n");
    });
  }

  async stop() {
    if (this.serverProcess) {
      this.serverProcess.kill();
    }
  }
}

async function runTests() {
  console.log("🚀 Starting MCP Server Tests\n");
  const client = new SimpleMCPClient();

  try {
    await client.start();
    console.log("✅ Server started\n");

    // Test 1: List tools
    console.log("Test 1: List Tools");
    console.log("─".repeat(50));
    const tools = await client.request("tools/list");
    console.log(`Found ${tools.tools?.length || 0} tools:`);
    tools.tools?.forEach((tool: any) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });
    console.log();

    // Test 2: Call login tool (will fail but should handle gracefully)
    console.log("Test 2: Call Login Tool (Invalid Credentials)");
    console.log("─".repeat(50));
    try {
      const result = await client.request("tools/call", {
        name: "instagram_login",
        arguments: {
          username: "test_user",
          password: "test_password",
        },
      });
      console.log("Result:", result);
    } catch (error: any) {
      console.log("Expected error:", error.message);
    }
    console.log();

    // Test 3: Call 2FA tool without pending login
    console.log("Test 3: Call 2FA Tool (No Pending Login)");
    console.log("─".repeat(50));
    try {
      const result = await client.request("tools/call", {
        name: "instagram_complete_2fa",
        arguments: {
          verification_code: "123456",
        },
      });
      console.log("Result:", result);
    } catch (error: any) {
      console.log("Expected error:", error.message);
    }
    console.log();

    console.log("✅ All tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await client.stop();
    console.log("\n🛑 Server stopped");
  }
}

runTests().catch(console.error);

