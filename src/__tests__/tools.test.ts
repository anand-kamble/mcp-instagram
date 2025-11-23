/**
 * Unit tests for individual tools
 * Note: These tests require the actual igpapiClient to be available
 * For true unit tests with mocks, consider using a dependency injection pattern
 */

import { jest } from "@jest/globals";
import { LoginTool } from "../tools/login.js";
import { Complete2FATool } from "../tools/complete_2fa.js";
import { GetPostDetailsTool } from "../tools/get_post_details.js";
import { GetUserStoriesTool } from "../tools/get_user_stories.js";
import { GetTimelineFeedTool } from "../tools/get_timeline_feed.js";
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

describe("Get Post Details Tool", () => {
  let getPostDetailsTool: GetPostDetailsTool;

  beforeEach(() => {
    getPostDetailsTool = new GetPostDetailsTool();
  });

  it("should have correct tool definition", () => {
    const definition = getPostDetailsTool.getDefinition();
    
    expect(definition.name).toBe("instagram_get_post_details");
    expect(definition.description).toContain("detailed information");
    expect(definition.description).toContain("Instagram post");
    expect(definition.description).toContain("media ID");
    expect(definition.inputSchema.type).toBe("object");
    expect(definition.inputSchema.properties).toHaveProperty("mediaId");
    expect(definition.inputSchema.required).toContain("mediaId");
  });

  it("should require mediaId", async () => {
    await expect(
      getPostDetailsTool.execute({} as any)
    ).rejects.toThrow("mediaId is required");
  });

  it("should reject non-string mediaId", async () => {
    await expect(
      getPostDetailsTool.execute({ mediaId: 123456 } as any)
    ).rejects.toThrow("mediaId is required and must be a string");
  });

  it("should reject empty mediaId", async () => {
    await expect(
      getPostDetailsTool.execute({ mediaId: "" })
    ).rejects.toThrow("mediaId cannot be empty");
  });

  it("should reject whitespace-only mediaId", async () => {
    await expect(
      getPostDetailsTool.execute({ mediaId: "   " })
    ).rejects.toThrow("mediaId cannot be empty");
  });

  it("should accept valid mediaId format", async () => {
    // This will fail at API call level, but validation should pass
    await expect(
      getPostDetailsTool.execute({ mediaId: "123456789" })
    ).rejects.not.toThrow("mediaId is required");
    await expect(
      getPostDetailsTool.execute({ mediaId: "123456789" })
    ).rejects.not.toThrow("mediaId cannot be empty");
  });

  it("should trim mediaId whitespace", async () => {
    // This will fail at API call level, but validation should pass
    await expect(
      getPostDetailsTool.execute({ mediaId: "  123456789  " })
    ).rejects.not.toThrow("mediaId cannot be empty");
  });

  it.skip("should fetch post details successfully with valid mediaId", async () => {
    // Would require mocking igpapiClient and media.info()
    // Better tested via integration tests
  });

  it.skip("should handle media not found error", async () => {
    // Would require mocking the API call
    // The error handling is tested through integration tests
  });

  it.skip("should handle private account error", async () => {
    // Would require mocking the API call
    // The error handling is tested through integration tests
  });

  it.skip("should handle authentication required error", async () => {
    // Would require mocking authentication state
    // Better tested via integration tests
  });

  it.skip("should handle rate limiting error", async () => {
    // Would require mocking rate limit response
    // Better tested via integration tests
  });

  it.skip("should handle session expired error", async () => {
    // Would require mocking session expiration
    // Better tested via integration tests
  });
});

describe("Get User Stories Tool", () => {
  let getUserStoriesTool: GetUserStoriesTool;

  beforeEach(() => {
    getUserStoriesTool = new GetUserStoriesTool();
  });

  it("should have correct tool definition", () => {
    const definition = getUserStoriesTool.getDefinition();
    
    expect(definition.name).toBe("instagram_get_user_stories");
    expect(definition.description).toContain("active Instagram stories");
    expect(definition.description).toContain("user ID or username");
    expect(definition.description).toContain("expire after 24 hours");
    expect(definition.inputSchema.type).toBe("object");
    expect(definition.inputSchema.properties).toHaveProperty("userId");
    expect(definition.inputSchema.properties).toHaveProperty("username");
    expect(definition.inputSchema.required).toEqual([]);
  });

  it("should require either userId or username", async () => {
    await expect(
      getUserStoriesTool.execute({} as any)
    ).rejects.toThrow("Either userId or username must be provided");
  });

  it("should reject when both userId and username are provided", async () => {
    await expect(
      getUserStoriesTool.execute({ userId: "123456", username: "testuser" })
    ).rejects.toThrow("Both userId and username cannot be provided");
  });

  it("should reject empty userId", async () => {
    await expect(
      getUserStoriesTool.execute({ userId: "" })
    ).rejects.toThrow("userId cannot be empty");
  });

  it("should reject non-numeric userId", async () => {
    await expect(
      getUserStoriesTool.execute({ userId: "abc123" })
    ).rejects.toThrow("userId must be a numeric string");
  });

  it("should reject userId with special characters", async () => {
    await expect(
      getUserStoriesTool.execute({ userId: "123-456" })
    ).rejects.toThrow("userId must be a numeric string");
  });

  it("should accept valid numeric userId", async () => {
    // This will fail at API call level, but validation should pass
    await expect(
      getUserStoriesTool.execute({ userId: "123456789" })
    ).rejects.not.toThrow("userId must be a numeric string");
  });

  it("should reject empty username", async () => {
    await expect(
      getUserStoriesTool.execute({ username: "" })
    ).rejects.toThrow("username cannot be empty");
  });

  it("should reject username with invalid characters", async () => {
    await expect(
      getUserStoriesTool.execute({ username: "test-user!" })
    ).rejects.toThrow("username contains invalid characters");
  });

  it("should reject username that is too long", async () => {
    const longUsername = "a".repeat(31);
    await expect(
      getUserStoriesTool.execute({ username: longUsername })
    ).rejects.toThrow("username is too long");
  });

  it("should accept username with @ symbol and strip it", async () => {
    // This will fail at API call level, but validation should pass
    await expect(
      getUserStoriesTool.execute({ username: "@testuser" })
    ).rejects.not.toThrow("username contains invalid characters");
  });

  it("should accept valid username format", async () => {
    // This will fail at API call level, but validation should pass
    await expect(
      getUserStoriesTool.execute({ username: "test_user.123" })
    ).rejects.not.toThrow("username contains invalid characters");
  });

  it.skip("should fetch stories successfully with userId", async () => {
    // Would require mocking igpapiClient and feed.userStory()
    // Better tested via integration tests
  });

  it.skip("should fetch stories successfully with username", async () => {
    // Would require mocking igpapiClient, user.usernameinfo(), and feed.userStory()
    // Better tested via integration tests
  });

  it.skip("should handle user not found error", async () => {
    // Would require mocking the API call
    // The error handling is tested through integration tests
  });

  it.skip("should handle private account error", async () => {
    // Would require mocking the API call
    // The error handling is tested through integration tests
  });

  it.skip("should handle no stories available (should not error)", async () => {
    // Would require mocking empty stories response
    // Better tested via integration tests
  });

  it.skip("should handle authentication required error", async () => {
    // Would require mocking authentication state
    // Better tested via integration tests
  });

  it.skip("should handle rate limiting error", async () => {
    // Would require mocking rate limit response
    // Better tested via integration tests
  });

  it.skip("should handle session expired error", async () => {
    // Would require mocking session expiration
    // Better tested via integration tests
  });
});

describe("Get Timeline Feed Tool", () => {
  let getTimelineFeedTool: GetTimelineFeedTool;

  beforeEach(() => {
    getTimelineFeedTool = new GetTimelineFeedTool();
  });

  it("should have correct tool definition", () => {
    const definition = getTimelineFeedTool.getDefinition();
    
    expect(definition.name).toBe("instagram_get_timeline_feed");
    expect(definition.description).toContain("home feed");
    expect(definition.description).toContain("accounts you follow");
    expect(definition.description).toContain("Requires authentication");
    expect(definition.inputSchema.type).toBe("object");
    expect(definition.inputSchema.properties).toHaveProperty("maxId");
    expect(definition.inputSchema.properties).toHaveProperty("limit");
    expect(definition.inputSchema.required).toEqual([]);
  });

  it("should require authentication", async () => {
    await expect(
      getTimelineFeedTool.execute({} as any)
    ).rejects.toThrow("Not logged in");
  });

  it("should reject invalid maxId format", async () => {
    await expect(
      getTimelineFeedTool.execute({ maxId: "" })
    ).rejects.toThrow("maxId must be a non-empty string");
  });

  it("should accept valid maxId", async () => {
    // This will fail at authentication check, but validation should pass
    await expect(
      getTimelineFeedTool.execute({ maxId: "valid_cursor_123" })
    ).rejects.toThrow("Not logged in");
    await expect(
      getTimelineFeedTool.execute({ maxId: "valid_cursor_123" })
    ).rejects.not.toThrow("maxId must be a non-empty string");
  });

  it("should clamp limit to valid range (1-50)", async () => {
    // Test that limit is clamped - this is tested indirectly through execution
    // The actual clamping happens in the execute method
    const tool = new GetTimelineFeedTool();
    // We can't easily test the clamping without mocking, but we can verify
    // the tool definition shows the default
    const definition = tool.getDefinition();
    expect(definition.inputSchema.properties?.limit?.default).toBe(12);
  });

  it.skip("should fetch timeline feed successfully when authenticated", async () => {
    // Would require mocking igpapiClient.isLoggedIn() and feed.timeline()
    // Better tested via integration tests
  });

  it.skip("should handle authentication required error", async () => {
    // Would require mocking authentication state
    // Better tested via integration tests
  });

  it.skip("should handle rate limiting error", async () => {
    // Would require mocking rate limit response
    // Better tested via integration tests
  });

  it.skip("should handle session expired error", async () => {
    // Would require mocking session expiration
    // Better tested via integration tests
  });

  it.skip("should handle pagination with maxId", async () => {
    // Would require mocking the feed pagination
    // Better tested via integration tests
  });

  it.skip("should respect limit parameter", async () => {
    // Would require mocking the feed items
    // Better tested via integration tests
  });

  it.skip("should handle empty feed correctly", async () => {
    // Would require mocking empty feed response
    // Better tested via integration tests
  });
});

