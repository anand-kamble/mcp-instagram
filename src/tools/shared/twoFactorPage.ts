/**
 * A one-time local web page for entering an Instagram two-factor code.
 *
 * The MCP spec forbids collecting secrets that grant access through form-mode
 * elicitation, and a code typed into the chat passes through the model.
 * URL-mode elicitation is the spec's mechanism for this case: the client
 * opens a URL in the user's browser and the secret goes straight to the
 * server. This module serves that URL.
 *
 * - Listens on 127.0.0.1 only, on a random port, at an unguessable path
 *   (32 random bytes). Requests whose Host header is not exactly that origin
 *   are refused, which blocks DNS rebinding; a cross-origin POST is refused.
 * - One verdict only: after Instagram accepts or rejects a code the listener
 *   closes. A malformed code is rejected locally and the page stays usable.
 * - Expires after 10 minutes. The code is never logged.
 *
 * Clients without URL-mode elicitation get the URL in the tool result, so the
 * token reaches the model's context. That is acceptable: the token only lets
 * its holder submit a code to this 127.0.0.1 listener, it reveals nothing, and
 * the code itself still comes from the user.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

export type TwoFactorOutcome =
  | { status: "completed" }
  | { status: "rejected"; message: string }
  | { status: "expired" };

export interface TwoFactorPageOptions {
  /**
   * Identity of the pending login this page belongs to. A page is only reused
   * for the same owner; a new pending login gets a new page.
   */
  owner: object;
  /** Plain-text lines shown above the form (who is logging in, where the code was sent). */
  description: string;
  /** Verifies the code with Instagram; throws if Instagram rejects it. */
  submit: (code: string) => Promise<void>;
  /** Lifetime of the page. Default 10 minutes. */
  ttlMs?: number;
}

export const TWO_FACTOR_PAGE_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 1024;
const CODE = /^\d{6,8}$/;

const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; color: #222; }
  input { font-size: 1.5rem; letter-spacing: 0.2em; width: 10ch; padding: 0.3rem; }
  button { font-size: 1rem; padding: 0.4rem 1rem; margin-left: 0.5rem; }
  .error { color: #b00020; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

export class TwoFactorPage {
  readonly url: string;
  /** Settles once: completed, rejected by Instagram, or expired/closed. */
  readonly outcome: Promise<TwoFactorOutcome>;

  private readonly path: string;
  private readonly origin: string;
  private resolveOutcome!: (outcome: TwoFactorOutcome) => void;
  private done = false;
  private submitting = false;
  private readonly timer: NodeJS.Timeout;

  private constructor(
    private readonly server: Server,
    port: number,
    token: string,
    private readonly options: TwoFactorPageOptions
  ) {
    this.origin = `127.0.0.1:${port}`;
    this.path = `/2fa/${token}`;
    this.url = `http://${this.origin}${this.path}`;
    this.outcome = new Promise((resolve) => (this.resolveOutcome = resolve));
    this.timer = setTimeout(() => this.finish({ status: "expired" }), options.ttlMs ?? TWO_FACTOR_PAGE_TTL_MS);
    this.timer.unref();
    server.on("request", (req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) this.send(res, 500, "Error", "<p>Something went wrong.</p>");
      });
    });
  }

  /** Starts the local listener and returns the page. */
  static async open(options: TwoFactorPageOptions): Promise<TwoFactorPage> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    // The page must not keep the MCP server process alive on its own.
    server.unref();
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Could not start the local two-factor page.");
    }
    return new TwoFactorPage(server, address.port, randomBytes(32).toString("base64url"), options);
  }

  get settled(): boolean {
    return this.done;
  }

  get owner(): object {
    return this.options.owner;
  }

  /** Closes the page without a verdict (e.g. the login was abandoned). */
  close(): void {
    this.finish({ status: "expired" });
  }

  private finish(outcome: TwoFactorOutcome): void {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    this.resolveOutcome(outcome);
    // Let the final response flush, then stop accepting connections.
    setImmediate(() => {
      this.server.close();
      this.server.closeAllConnections();
    });
  }

  private pathMatches(rawUrl: string | undefined): boolean {
    const actual = Buffer.from((rawUrl ?? "").split("?")[0]);
    const expected = Buffer.from(this.path);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private send(res: ServerResponse, status: number, title: string, body: string): void {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" });
    res.end(page(title, body));
  }

  private form(error?: string): string {
    const description = this.options.description
      .split("\n")
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("\n");
    return `${description}
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<form method="post" autocomplete="off">
  <label for="code">Verification code</label><br>
  <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required autofocus>
  <button type="submit">Log in</button>
</form>`;
  }

  private async readBody(req: IncomingMessage): Promise<string | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) return undefined;
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.host !== this.origin) {
      this.send(res, 403, "Forbidden", "<p>Forbidden.</p>");
      return;
    }
    if (!this.pathMatches(req.url)) {
      this.send(res, 404, "Not found", "<p>Not found.</p>");
      return;
    }
    if (this.done) {
      this.send(res, 410, "Page expired", "<p>This page is no longer valid. Ask your assistant to log in again.</p>");
      return;
    }
    if (req.method === "GET") {
      this.send(res, 200, "Instagram verification code", this.form());
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, POST" });
      res.end();
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${this.origin}`) {
      this.send(res, 403, "Forbidden", "<p>Forbidden.</p>");
      return;
    }
    if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
      this.send(res, 415, "Unsupported", "<p>Unsupported request.</p>");
      return;
    }
    const body = await this.readBody(req);
    if (body === undefined) {
      this.send(res, 413, "Too large", "<p>Request too large.</p>");
      return;
    }
    if (this.submitting) {
      this.send(res, 409, "Busy", "<p>A code is already being checked. Wait a moment, then reload.</p>");
      return;
    }

    const code = (new URLSearchParams(body).get("code") ?? "").replace(/\s+/g, "");
    if (!CODE.test(code)) {
      this.send(res, 400, "Instagram verification code", this.form("The code must be 6 to 8 digits."));
      return;
    }

    this.submitting = true;
    try {
      await this.options.submit(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.send(
        res,
        200,
        "Code rejected",
        `<p class="error">Instagram did not accept that code.</p><p>Ask your assistant to log in again to get a new code.</p>`
      );
      this.finish({ status: "rejected", message });
      return;
    } finally {
      this.submitting = false;
    }
    this.send(res, 200, "Logged in", "<p>You are logged in to Instagram. You can close this tab.</p>");
    this.finish({ status: "completed" });
  }
}

// ---------------------------------------------------------------------------
// The page for the current pending login (at most one at a time)
// ---------------------------------------------------------------------------

let current: TwoFactorPage | undefined;

/**
 * Returns the open page for this pending login, or opens one. A page that
 * belongs to an older pending login is closed first, so it can never submit
 * a code into a newer login.
 */
export async function twoFactorPageFor(options: TwoFactorPageOptions): Promise<TwoFactorPage> {
  if (current && !current.settled && current.owner === options.owner) {
    return current;
  }
  closeTwoFactorPage();
  current = await TwoFactorPage.open(options);
  return current;
}

/** The most recent page, settled or not (its outcome tells how it ended). */
export function latestTwoFactorPage(): TwoFactorPage | undefined {
  return current;
}

/** Closes the page, e.g. after the login finished another way. */
export function closeTwoFactorPage(): void {
  current?.close();
  current = undefined;
}
