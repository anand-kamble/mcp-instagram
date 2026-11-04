/**
 * Unit tests for the Instagram private-API client core (no network).
 */

import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import {
  applySetCookies,
  APP_PROFILE,
  encryptPassword,
  formatAuthorizationHeader,
  IgActionSpamError,
  IgBadPasswordError,
  IgCheckpointError,
  IgLoginRequiredError,
  IgNeedsUpgradeError,
  IgNetworkError,
  IgNoSessionError,
  IgNotFoundError,
  IgPrivateUserError,
  IgRateLimitedError,
  IgResponseError,
  IgSentryBlockError,
  IgTwoFactorRequiredError,
  IgUserHasLoggedOutError,
  InstagramClient,
  parseAuthorizationHeader,
  parseJsonPreservingBigInts,
} from "../instagram/index.js";
import type { SessionState } from "../instagram/index.js";

interface Sent {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A fetch stand-in that records requests and replays canned responses. */
function fakeFetch(responses: Array<{ status?: number; body?: unknown; text?: string; headers?: [string, string][] }>) {
  const sent: Sent[] = [];
  const impl = (async (input: URL | string, init?: RequestInit) => {
    sent.push({
      url: new URL(String(input)),
      method: String(init?.method),
      headers: init?.headers as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const next = responses.shift() ?? { status: 200, body: { status: "ok" } };
    const text = next.text ?? JSON.stringify(next.body ?? { status: "ok" });
    return new Response(text, { status: next.status ?? 200, headers: next.headers ?? [] });
  }) as typeof fetch;
  return { impl, sent };
}

const AUTH = { ds_user_id: "42", sessionid: "42%3Aabc%3A1%3AAYc", should_use_header_over_cookies: true };

describe("InstagramClient.request", () => {
  it("sends a GET with the app headers and query string", async () => {
    const { impl, sent } = fakeFetch([{ body: { status: "ok", user: { pk: 1 } } }]);
    const client = new InstagramClient({ fetch: impl });

    const result = await client.request<{ user: { pk: number } }>({
      path: "users/1/info/",
      query: { from_module: "feed", skip: undefined },
    });

    expect(result.user.pk).toBe(1);
    const [req] = sent;
    expect(req.method).toBe("GET");
    expect(req.url.href).toBe("https://i.instagram.com/api/v1/users/1/info/?from_module=feed");
    expect(req.body).toBeUndefined();
    expect(req.headers["User-Agent"]).toBe(
      `Instagram ${APP_PROFILE.appVersion} Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; ${APP_PROFILE.versionCode})`
    );
    expect(req.headers["X-Bloks-Version-Id"]).toBe(APP_PROFILE.bloksVersionId);
    expect(req.headers["X-IG-App-ID"]).toBe("567067343352427");
    expect(req.headers["X-IG-Device-ID"]).toBe(client.device.uuid);
    expect(req.headers["X-IG-Android-ID"]).toMatch(/^android-[0-9a-f]{16}$/);
    expect(req.headers.Authorization).toBeUndefined();
  });

  it("signs POST forms as signed_body=SIGNATURE.<json>", async () => {
    const { impl, sent } = fakeFetch([{}]);
    const client = new InstagramClient({ fetch: impl });

    await client.request({ path: "media/1_2/like/", form: { media_id: "1_2", text: "a b&c" } });

    const [req] = sent;
    expect(req.method).toBe("POST");
    expect(req.headers["Content-Type"]).toBe("application/x-www-form-urlencoded; charset=UTF-8");
    const params = new URLSearchParams(req.body);
    expect([...params.keys()]).toEqual(["signed_body"]);
    expect(params.get("signed_body")).toBe('SIGNATURE.{"media_id":"1_2","text":"a b&c"}');
  });

  it("sends unsigned forms as plain fields", async () => {
    const { impl, sent } = fakeFetch([{}]);
    const client = new InstagramClient({ fetch: impl });

    await client.request({ path: "x/", form: { a: "1", b: { c: true }, d: undefined }, signed: false });

    expect(new URLSearchParams(sent[0].body).toString()).toBe("a=1&b=%7B%22c%22%3Atrue%7D");
  });

  it("learns session state from ig-set-* headers and cookies, then sends it back", async () => {
    const issued = formatAuthorizationHeader(AUTH);
    const { impl, sent } = fakeFetch([
      {
        headers: [
          ["ig-set-authorization", issued],
          ["ig-set-x-mid", "MID123"],
          ["ig-set-ig-u-rur", "RUR456"],
          ["x-ig-set-www-claim", "hmac.CLAIM"],
          ["ig-set-password-encryption-key-id", "189"],
          ["ig-set-password-encryption-pub-key", "UFVCS0VZ"],
          ["set-cookie", "csrftoken=tok; Path=/; Domain=.instagram.com"],
          ["set-cookie", "mid=MID123; Path=/"],
        ],
      },
      {},
    ]);
    const client = new InstagramClient({ fetch: impl });

    await client.request({ path: "launcher/sync/", form: {} });
    expect(client.userId).toBe("42");
    expect(client.hasSession).toBe(true);
    expect(client.passwordEncryptionKey).toEqual({ keyId: 189, publicKey: "UFVCS0VZ" });

    await client.request({ path: "accounts/current_user/" });
    const headers = sent[1].headers;
    expect(headers.Authorization).toBe(issued);
    expect(headers["X-MID"]).toBe("MID123");
    expect(headers["IG-U-RUR"]).toBe("RUR456");
    expect(headers["IG-U-DS-USER-ID"]).toBe("42");
    expect(headers["X-IG-WWW-Claim"]).toBe("hmac.CLAIM");
    expect(headers.Cookie).toBe("csrftoken=tok; mid=MID123");
  });

  it.each([
    [403, { status: "fail", message: "login_required" }, IgLoginRequiredError],
    [400, { status: "fail", message: "user_has_logged_out" }, IgUserHasLoggedOutError],
    [400, { status: "fail", message: "challenge_required", challenge: { url: "x" } }, IgCheckpointError],
    [400, { status: "fail", message: "feedback_required", feedback_message: "Try later" }, IgActionSpamError],
    [400, { status: "fail", error_type: "sentry_block" }, IgSentryBlockError],
    [429, { status: "fail", message: "rate limited" }, IgRateLimitedError],
    [400, { status: "fail", message: "Please wait a few minutes before you try again." }, IgRateLimitedError],
    [400, { status: "fail", message: "", two_factor_info: { two_factor_identifier: "id" } }, IgTwoFactorRequiredError],
    [400, { status: "fail", error_type: "bad_password", message: "wrong" }, IgBadPasswordError],
    [400, { status: "fail", error_type: "needs_upgrade", message: "out of date" }, IgNeedsUpgradeError],
    [400, { status: "fail", message: "Not authorized to view user" }, IgPrivateUserError],
    [400, { status: "fail", message: "Media is unavailable" }, IgNotFoundError],
    [404, { status: "fail", message: "Page not found" }, IgNotFoundError],
    [200, { status: "fail", message: "counter get error" }, IgResponseError],
  ])("maps HTTP %d %j to the matching error", async (status, body, errorClass) => {
    const { impl } = fakeFetch([{ status, body }]);
    const client = new InstagramClient({ fetch: impl });
    const error = await client.request({ path: "x/" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(errorClass);
    expect((error as IgResponseError).status).toBe(status);
    expect((error as IgResponseError).path).toBe("x/");
  });

  it("exposes two_factor_info on IgTwoFactorRequiredError", async () => {
    const info = { two_factor_identifier: "abc", totp_two_factor_on: true, username: "alice" };
    const { impl } = fakeFetch([{ status: 400, body: { status: "fail", two_factor_info: info } }]);
    const error = await new InstagramClient({ fetch: impl }).request({ path: "x/" }).catch((e: unknown) => e);
    expect((error as IgTwoFactorRequiredError).twoFactorInfo).toEqual(info);
  });

  it("treats a bare 'Not Found' body as a masked checkpoint", async () => {
    const { impl } = fakeFetch([{ status: 404, text: "Not Found" }]);
    const error = await new InstagramClient({ fetch: impl }).request({ path: "media/1/comments/" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IgCheckpointError);
  });

  it("reports transport failures and non-JSON success as IgNetworkError", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new InstagramClient({ fetch: failing }).request({ path: "x/" })).rejects.toBeInstanceOf(IgNetworkError);

    const { impl } = fakeFetch([{ status: 200, text: "<html>" }]);
    await expect(new InstagramClient({ fetch: impl }).request({ path: "x/" })).rejects.toThrow(/non-JSON/);
  });

  it("aborts requests that exceed the timeout", async () => {
    const hanging = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const client = new InstagramClient({ fetch: hanging, timeoutMs: 20 });
    await expect(client.request({ path: "x/" })).rejects.toThrow(/x\/ failed/);
  });
});

describe("session state", () => {
  it("round-trips through serialize and keeps the device stable", () => {
    const { impl } = fakeFetch([]);
    const client = new InstagramClient({ fetch: impl });
    client.setAuthorization(AUTH);
    client.setAccount("42", "alice");

    const saved = client.serialize();
    expect(saved.version).toBe(2);
    expect(saved.authorization).toEqual(AUTH);
    expect(saved.cookies).toEqual({ sessionid: AUTH.sessionid, ds_user_id: "42" });

    const restored = new InstagramClient({ fetch: impl, session: JSON.parse(JSON.stringify(saved)) as SessionState });
    expect(restored.device).toEqual(client.device);
    expect(restored.userId).toBe("42");
    expect(restored.username).toBe("alice");
    expect(restored.hasSession).toBe(true);
  });

  it("moves a saved device to the current app version", () => {
    const old = new InstagramClient({ fetch: fakeFetch([]).impl }).serialize();
    old.device = { ...old.device, appVersion: "222.0.0.13.114", versionCode: "350696709", bloksVersionId: "old" };
    const restored = new InstagramClient({ session: old, fetch: fakeFetch([]).impl });
    expect(restored.device.appVersion).toBe(APP_PROFILE.appVersion);
    expect(restored.device.uuid).toBe(old.device.uuid);
  });

  it("clearSession drops credentials and cookies but keeps the device", () => {
    const client = new InstagramClient({ fetch: fakeFetch([]).impl });
    const uuid = client.device.uuid;
    client.setAuthorization(AUTH);
    client.clearSession();
    expect(client.hasSession).toBe(false);
    expect(client.userId).toBeUndefined();
    expect(client.serialize().cookies).toEqual({});
    expect(client.device.uuid).toBe(uuid);
    expect(() => client.requireSession()).toThrow(IgNoSessionError);
  });
});

describe("helpers", () => {
  it("keeps integers beyond 2^53 exact by turning them into strings", () => {
    const text =
      '{"pk":3123456789012345678,"small":42,"neg":-9007199254740993,"f":1.5e3,' +
      '"s":"text 12345678901234567890 \\" 98765432109876543210","arr":[18012345678901234567,7]}';
    expect(parseJsonPreservingBigInts(text)).toEqual({
      pk: "3123456789012345678",
      small: 42,
      neg: "-9007199254740993",
      f: 1500,
      s: 'text 12345678901234567890 " 98765432109876543210',
      arr: ["18012345678901234567", 7],
    });
    expect(parseJsonPreservingBigInts('{"a":9007199254740991}')).toEqual({ a: 9007199254740991 });
    expect(() => parseJsonPreservingBigInts("<html>")).toThrow(SyntaxError);
  });

  it("returns exact ids from responses", async () => {
    const { impl } = fakeFetch([{ text: '{"status":"ok","comment":{"pk":18012345678901234567}}' }]);
    const body = await new InstagramClient({ fetch: impl }).request<{ comment: { pk: unknown } }>({ path: "x/" });
    expect(body.comment.pk).toBe("18012345678901234567");
  });

  it("parses and formats IGT:2 authorization headers", () => {
    const header = formatAuthorizationHeader(AUTH);
    expect(header.startsWith("Bearer IGT:2:")).toBe(true);
    expect(parseAuthorizationHeader(header)).toEqual(AUTH);
    expect(parseAuthorizationHeader("Bearer IGT:2:")).toBeUndefined();
    expect(parseAuthorizationHeader("Bearer IGT:2:bm90IGpzb24=")).toBeUndefined();
    expect(parseAuthorizationHeader(null)).toBeUndefined();
  });

  it("applies and expires cookies", () => {
    const jar: Record<string, string> = { old: "1", gone: "2" };
    applySetCookies(jar, [
      "sessionid=abc; Path=/; HttpOnly",
      "gone=; Max-Age=0",
      "old=\"\"; expires=Thu, 01 Jan 1970 00:00:00 GMT",
    ]);
    expect(jar).toEqual({ sessionid: "abc" });
  });

  it("encrypts passwords in Instagram's #PWD_INSTAGRAM:4 format", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const now = 1_700_000_000_000;

    const encrypted = encryptPassword("hunter2 ✓", { keyId: 189, publicKey: Buffer.from(pem).toString("base64") }, now);

    const [prefix, version, timestamp, payload] = encrypted.split(":");
    expect([prefix, version, timestamp]).toEqual(["#PWD_INSTAGRAM", "4", "1700000000"]);
    const bytes = Buffer.from(payload, "base64");
    expect(bytes[0]).toBe(1);
    expect(bytes[1]).toBe(189);
    const iv = bytes.subarray(2, 14);
    const rsaLength = bytes.readUInt16LE(14);
    expect(rsaLength).toBe(256);
    const rsaPart = bytes.subarray(16, 16 + rsaLength);
    const tag = bytes.subarray(16 + rsaLength, 32 + rsaLength);
    const ciphertext = bytes.subarray(32 + rsaLength);

    // Node refuses PKCS#1 v1.5 private decryption, so strip the padding by hand.
    const padded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, rsaPart);
    expect(padded[0]).toBe(0);
    expect(padded[1]).toBe(2);
    const sessionKey = padded.subarray(padded.indexOf(0, 2) + 1);
    expect(sessionKey.length).toBe(32);

    const decipher = createDecipheriv("aes-256-gcm", sessionKey, iv);
    decipher.setAAD(Buffer.from("1700000000"));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    expect(plain).toBe("hunter2 ✓");
  });
});
