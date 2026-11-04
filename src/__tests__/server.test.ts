/**
 * Server identity and tools/list metadata, on both protocol eras.
 */

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { Tool } from "@modelcontextprotocol/client";
import { connect, ERAS } from "./helpers.js";
import type { Connection } from "./helpers.js";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
};

const EXPECTED_TOOLS = [
  "instagram_login",
  "instagram_complete_2fa",
  "instagram_search_accounts",
  "instagram_logout",
  "instagram_get_user_profile",
  "instagram_get_current_user_profile",
  "instagram_get_user_posts",
  "instagram_like_post",
  "instagram_like_comment",
  "instagram_comment_on_post",
  "instagram_get_post_comments",
  "instagram_get_post_details",
  "instagram_get_user_stories",
  "instagram_get_timeline_feed",
  "instagram_follow_user",
];

const READ_ONLY_TOOLS = [
  "instagram_search_accounts",
  "instagram_get_user_profile",
  "instagram_get_current_user_profile",
  "instagram_get_user_posts",
  "instagram_get_post_comments",
  "instagram_get_post_details",
  "instagram_get_user_stories",
  "instagram_get_timeline_feed",
];

describe.each(ERAS)("server on the %s protocol era", (era) => {
  let connection: Connection;
  let tools: Tool[];

  beforeEach(async () => {
    connection = await connect(era);
    tools = (await connection.client.listTools()).tools;
  });

  afterEach(async () => {
    await connection.close();
  });

  it("identifies itself with the package name and version", () => {
    const info = connection.client.getServerVersion();
    expect(info?.name).toBe(pkg.name);
    expect(info?.version).toBe(pkg.version);
    expect(info?.title).toBe("Instagram");
  });

  it("sends instructions that warn about untrusted content and public actions", () => {
    const instructions = connection.client.getInstructions() ?? "";
    expect(instructions).toContain("instagram_login");
    expect(instructions).toMatch(/untrusted/i);
  });

  it("lists every tool in a fixed order", () => {
    expect(tools.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  });

  it("gives every tool a title, description, object input schema and explicit annotations", () => {
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description?.length ?? 0).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(tool.annotations?.openWorldHint).toBe(true);
    }
  });

  it("marks the read tools read-only and gives them an output schema", () => {
    for (const name of READ_ONLY_TOOLS) {
      const tool = tools.find((candidate) => candidate.name === name);
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.outputSchema?.type).toBe("object");
    }
  });

  it("marks write tools as non-destructive, except logout", () => {
    const writeTools = tools.filter((tool) => !READ_ONLY_TOOLS.includes(tool.name));
    for (const tool of writeTools) {
      expect(tool.annotations?.readOnlyHint).toBe(false);
      expect(tool.annotations?.destructiveHint).toBe(tool.name === "instagram_logout");
    }
  });

  it("marks commenting as not idempotent, and likes and follows as idempotent", () => {
    const hint = (name: string) => tools.find((tool) => tool.name === name)?.annotations?.idempotentHint;
    expect(hint("instagram_comment_on_post")).toBe(false);
    expect(hint("instagram_like_post")).toBe(true);
    expect(hint("instagram_like_comment")).toBe(true);
    expect(hint("instagram_follow_user")).toBe(true);
  });

  it("exposes required parameters in the input schema", () => {
    const schema = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema;
    expect(schema("instagram_like_post")?.required).toEqual(["mediaId"]);
    expect(schema("instagram_comment_on_post")?.required).toEqual(expect.arrayContaining(["mediaId", "text"]));
    expect(schema("instagram_complete_2fa")?.required).toEqual(["verification_code"]);
  });

  it("answers unknown tools with an error", async () => {
    const outcome = await connection.client
      .callTool({ name: "instagram_does_not_exist", arguments: {} })
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error })
      );
    if ("result" in outcome) {
      expect(outcome.result.isError).toBe(true);
    } else {
      expect(outcome.error).toBeInstanceOf(Error);
    }
  });
});
