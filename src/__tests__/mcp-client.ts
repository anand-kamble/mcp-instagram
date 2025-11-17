/**
 * MCP Test Client
 * Communicates with MCP server via stdio using JSON-RPC 2.0
 */

import { spawn, ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

// Get __dirname equivalent for ES modules
function getDirname() {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    // Fallback for environments where import.meta is not available
    return process.cwd();
  }
}

const __dirname = getDirname();

export interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

export interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class MCPTestClient {
  private serverProcess: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, {
    resolve: (value: JSONRPCResponse) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private messageBuffer = "";

  /**
   * Start the MCP server process
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverPath = join(__dirname, "../../build/server.js");
      const projectRoot = join(__dirname, "../..");

      this.serverProcess = spawn("node", [serverPath], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // Don't auto-login during tests
          IG_USERNAME: "",
          IG_PASSWORD: "",
        },
      });

      // Handle stdout (server responses)
      this.serverProcess.stdout?.on("data", (data: Buffer) => {
        this.messageBuffer += data.toString();
        this.processMessages();
      });

      // Handle stderr (server logs)
      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        // Log server output for debugging
        const message = data.toString();
        if (!message.includes("Insta MCP server running")) {
          console.log("[SERVER]", message.trim());
        }
      });

      // Wait for server to be ready
      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        if (data.toString().includes("Insta MCP server running")) {
          resolve();
        }
      });

      this.serverProcess.on("error", (error) => {
        reject(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!this.serverProcess?.killed) {
          resolve(); // Assume ready if no error
        }
      }, 5000);
    });
  }

  /**
   * Process buffered messages (handle newline-delimited JSON)
   */
  private processMessages(): void {
    const lines = this.messageBuffer.split("\n");
    this.messageBuffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response: JSONRPCResponse = JSON.parse(line);
          this.handleResponse(response);
        } catch (error) {
          // Ignore parse errors (might be log output)
        }
      }
    }
  }

  /**
   * Handle incoming JSON-RPC response
   */
  private handleResponse(response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(
          new Error(`JSON-RPC Error: ${response.error.message} (${response.error.code})`)
        );
      } else {
        pending.resolve(response);
      }
    }
  }

  /**
   * Send a JSON-RPC request and wait for response
   */
  async request(method: string, params?: any, timeout = 30000): Promise<any> {
    if (!this.serverProcess) {
      throw new Error("Server not started. Call start() first.");
    }

    const id = ++this.requestId;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: (response) => resolve(response.result),
        reject,
        timeout: timeoutHandle,
      });

      // Send request to server via stdin
      const requestLine = JSON.stringify(request) + "\n";
      this.serverProcess!.stdin?.write(requestLine);
    });
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any[]> {
    const response = await this.request("tools/list");
    return response.tools || [];
  }

  /**
   * Call a tool
   */
  async callTool(name: string, args: Record<string, any>): Promise<any> {
    return await this.request("tools/call", {
      name,
      arguments: args,
    });
  }

  /**
   * Stop the server process
   */
  async stop(): Promise<void> {
    if (this.serverProcess) {
      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Server stopped"));
      }
      this.pendingRequests.clear();

      // Kill the process
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }
}

