/**
 * The one-time local two-factor code page: who may reach it, what it accepts,
 * and that it gives exactly one verdict.
 */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { request } from "node:http";
import { TwoFactorPage, closeTwoFactorPage, twoFactorPageFor } from "../tools/shared/twoFactorPage.js";

const pages: TwoFactorPage[] = [];
async function open(submit: (code: string) => Promise<void> = async () => undefined, ttlMs?: number) {
  const page = await TwoFactorPage.open({ owner: {}, description: "Enter <the> code", submit, ttlMs });
  pages.push(page);
  return page;
}

afterEach(() => {
  for (const page of pages.splice(0)) page.close();
  closeTwoFactorPage();
});

/** Raw request with full control over the Host and Origin headers. */
function raw(url: string, options: { method?: string; host?: string; headers?: Record<string, string>; body?: string }) {
  const target = new URL(url);
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: target.port,
        path: target.pathname,
        method: options.method ?? "GET",
        headers: { Host: options.host ?? target.host, ...(options.headers ?? {}) },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

const form = { "Content-Type": "application/x-www-form-urlencoded" };

describe("two-factor code page", () => {
  it("serves the form on 127.0.0.1 with strict security headers and escaped text", async () => {
    const page = await open();
    expect(page.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/2fa\/[A-Za-z0-9_-]{43}$/);
    const response = await raw(page.url, {});
    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["content-security-policy"]).toContain("form-action 'self'");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.body).toContain("Enter &#60;the&#62; code");
    expect(response.body).not.toContain("<the>");
  });

  it("refuses other Host headers (DNS rebinding) and other paths", async () => {
    const page = await open();
    expect((await raw(page.url, { host: "evil.example" })).status).toBe(403);
    expect((await raw(page.url, { host: "localhost:" + new URL(page.url).port })).status).toBe(403);
    expect((await raw(page.url.replace(/[^/]+$/, "wrong"), {})).status).toBe(404);
  });

  it("refuses cross-origin posts, other content types and large bodies", async () => {
    const submit = jest.fn(async () => undefined);
    const page = await open(submit);
    const post = (headers: Record<string, string>, body: string) => raw(page.url, { method: "POST", headers, body });
    expect((await post({ ...form, Origin: "https://evil.example" }, "code=123456")).status).toBe(403);
    expect((await post({ "Content-Type": "application/json" }, '{"code":"123456"}')).status).toBe(415);
    expect((await post(form, "code=" + "1".repeat(2000))).status).toBe(413);
    expect(submit).not.toHaveBeenCalled();
    expect(page.settled).toBe(false);
  });

  it("rejects malformed codes locally without using up the page", async () => {
    const submit = jest.fn(async () => undefined);
    const page = await open(submit);
    expect((await raw(page.url, { method: "POST", headers: form, body: "code=12ab" })).status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
    expect(page.settled).toBe(false);
  });

  it("gives exactly one verdict and then closes", async () => {
    const submit = jest.fn(async () => undefined);
    const page = await open(submit);
    const response = await raw(page.url, {
      method: "POST",
      headers: { ...form, Origin: new URL(page.url).origin },
      body: "code=123+456",
    });
    expect(response.status).toBe(200);
    expect(submit).toHaveBeenCalledWith("123456");
    await expect(page.outcome).resolves.toEqual({ status: "completed" });
    await new Promise((resolve) => setImmediate(resolve));
    await expect(raw(page.url, {})).rejects.toThrow();
  });

  it("reports Instagram's rejection and closes", async () => {
    const page = await open(async () => {
      throw new Error("wrong code");
    });
    const response = await raw(page.url, { method: "POST", headers: form, body: "code=999999" });
    expect(response.body).toContain("did not accept");
    expect(response.body).not.toContain("999999");
    await expect(page.outcome).resolves.toEqual({ status: "rejected", message: "wrong code" });
  });

  it("expires after its lifetime", async () => {
    const page = await open(async () => undefined, 30);
    await expect(page.outcome).resolves.toEqual({ status: "expired" });
  });

  it("reuses the page only for the same pending login", async () => {
    const owner = {};
    const first = await twoFactorPageFor({ owner, description: "x", submit: async () => undefined });
    expect(await twoFactorPageFor({ owner, description: "x", submit: async () => undefined })).toBe(first);
    const second = await twoFactorPageFor({ owner: {}, description: "x", submit: async () => undefined });
    expect(second).not.toBe(first);
    await expect(first.outcome).resolves.toEqual({ status: "expired" });
  });
});
