/**
 * Unit tests for individual tools
 * Note: These tests require the actual igpapiClient to be available
 * For true unit tests with mocks, consider using a dependency injection pattern
 */

import { jest } from "@jest/globals";
import { LoginTool } from "../tools/login.js";
import { Complete2FATool } from "../tools/complete_2fa.js";
import { igpapiClient } from "../igpapi/index.js";

// Note: ESM mocking is complex. These tests use the actual client.
// For production, consider refactoring to use dependency injection.

describe("Login Tool", () => {
  let loginTool: LoginTool;

  beforeEach(() => {
    loginTool = new LoginTool();
  });

  it("should have correct tool definition", () => {
    const definition = loginTool.getDefinition();
    
    expect(definition.name).toBe("instagram_login");
    expect(definition.description).toContain("Login");
    expect(definition.inputSchema.type).toBe("object");
    // Login tool uses environment variables, so no required parameters in schema
    expect(definition.inputSchema.required).toEqual([]);
  });

  it("should validate that credentials are available", async () => {
    // Clear env vars for this test
    const originalUsername = process.env.IG_USERNAME;
    const originalPassword = process.env.IG_PASSWORD;
    delete process.env.IG_USERNAME;
    delete process.env.IG_PASSWORD;
    
    // Reload config to pick up env var changes
    const { getConfig, setConfig } = await import("../config/index.js");
    setConfig({ igpapi: {} });
    
    await expect(
      loginTool.execute({} as any)
    ).rejects.toThrow("Instagram credentials not found");
    
    // Restore env vars
    if (originalUsername) process.env.IG_USERNAME = originalUsername;
    if (originalPassword) process.env.IG_PASSWORD = originalPassword;
  });

  // Note: These tests would require mocking igpapiClient which is complex with ESM
  // They are skipped but kept as examples. Integration tests in server.test.ts
  // provide better coverage of the actual behavior.
  
  it.skip("should check if already logged in", async () => {
    // Would require mocking igpapiClient.isLoggedIn and getCurrentUser
  });

  it.skip("should initialize client if not initialized", async () => {
    // Would require mocking the full client initialization flow
  });

  it.skip("should handle 2FA requirement", async () => {
    // Would require mocking the 2FA error flow
  });
});

describe("Complete 2FA Tool", () => {
  let complete2FATool: Complete2FATool;

  beforeEach(() => {
    complete2FATool = new Complete2FATool();
  });

  it("should have correct tool definition", () => {
    const definition = complete2FATool.getDefinition();
    
    expect(definition.name).toBe("instagram_complete_2fa");
    expect(definition.description).toContain("2FA");
    expect(definition.inputSchema.required).toContain("verification_code");
  });

  it("should require verification code", async () => {
    await expect(
      complete2FATool.execute({} as any)
    ).rejects.toThrow("required");
  });

  it("should reject if no pending 2FA", async () => {
    // This test works because it uses the actual client state
    await expect(
      complete2FATool.execute({ verification_code: "123456" })
    ).rejects.toThrow("pending");
  });

  it.skip("should complete 2FA login successfully", async () => {
    // Would require setting up a pending 2FA state, which is complex
    // Better tested via integration tests
  });

  it.skip("should handle invalid verification code", async () => {
    // Would require setting up a pending 2FA state first
    // Better tested via integration tests
  });
});

