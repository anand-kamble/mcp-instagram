/**
 * CAA password login flow against a fake Instagram (no network). Scenarios
 * and fixtures follow the CAA probe's offline checks, which were themselves
 * checked against instagrapi's parsers and tests.
 */

import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setConfig } from "../config/index.js";
import { IGPAPIClient } from "../igpapi/client.js";
import { loadSession } from "../igpapi/session.js";
import {
  AP_2SV_CODE_ENTRY,
  AP_2SV_CODE_ENTRY_ASYNC,
  AP_2SV_ENTRYPOINT,
  CaaLogin,
  formatAuthorizationHeader,
  IgBadPasswordError,
  IgLoginFallbackError,
  IgLoginFlowError,
  IgPasswordRejectedError,
  IgTwoFactorCodeError,
  InstagramClient,
  pyDumps,
} from "../instagram/index.js";
import type { Transport, TransportRequest } from "../instagram/index.js";
import { resetRateLimiter } from "../utils/rateLimit.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_KEY_B64 = Buffer.from(publicKey.export({ type: "spki", format: "pem" }).toString()).toString("base64");
const AUTH = { ds_user_id: "123", sessionid: "123%3Aabc", should_use_header_over_cookies: true };
const AAC = '{"aaccs":"AACCS","aacjid":"1"}';

const loginPayload = {
  login_response: pyDumps({ logged_in_user: { pk: 123, username: "example" }, credential_type: "password" }),
  headers: pyDumps({
    "IG-Set-Authorization": formatAuthorizationHeader(AUTH),
    "ig-set-ig-u-rur": "RUR,123,1:token",
    "x-ig-set-www-claim": "hmac.claim",
  }),
  cookies:
    "Set-Cookie: csrftoken=token-1; Domain=.instagram.com; Path=/; Secure\r\n" +
    "Set-Cookie: ds_user_id=123; Domain=.instagram.com; Path=/; Secure\r\n" +
    "Set-Cookie: sessionid=123%3Aabc; Domain=.instagram.com; Path=/; Secure",
};
const successAction = () => ({
  status: "ok",
  layout: { bloks_payload: { action: `BK.action(${pyDumps("ignored")}, ${pyDumps(pyDumps(loginPayload))})` } },
});
const navigate = (app: string, key: string, value: string, extra: Record<string, unknown> = {}) => ({
  status: "ok",
  ...extra,
  layout: { bloks_payload: { action: `"${app}" (f4i (dkc "${key}") (dkc "${value}"))` } },
});

interface Recorded {
  method: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  form?: Record<string, string>;
  body?: string;
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Handler = (req: Recorded) => Reply;

/** A fake Instagram for the CAA flow; `routes` override or extend the defaults by bloks action or path. */
function fakeInstagram(routes: Record<string, Handler> = {}, options: { usdidOk?: boolean } = {}) {
  const requests: Recorded[] = [];
  const reply = (r: Reply) => ({
    status: r.status,
    headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    setCookie: [],
    body: JSON.stringify(r.body),
  });
  const transport: Transport = async (req: TransportRequest) => {
    const url = new URL(req.url);
    const form =
      req.body && req.headers["Content-Type"]?.startsWith("application/x-www-form-urlencoded")
        ? Object.fromEntries(new URLSearchParams(req.body))
        : undefined;
    const rec: Recorded = { method: req.method, host: url.host, path: url.pathname + url.search, headers: req.headers, form, body: req.body };
    requests.push(rec);
    const action = /\/bloks\/(?:async_action|apps)\/([^/]+)\//.exec(url.pathname)?.[1];
    const route = (action && routes[action]) || routes[url.pathname];
    if (route) return reply(route(rec));
    switch (url.pathname) {
      case "/api/v1/launcher/sync/":
        return reply({
          status: 200,
          body: { status: "ok" },
          headers: {
            "ig-set-password-encryption-key-id": "189",
            "ig-set-password-encryption-pub-key": PUBLIC_KEY_B64,
            "ig-set-x-mid": "MID-from-launcher",
          },
        });
      case "/graphql_www":
        return reply({ status: 200, body: { data: { xdt_usdid_registration: { success: options.usdidOk !== false } } } });
      case "/api/v1/attestation/create_android_keystore/":
        return reply({ status: 200, body: { status: "ok", challenge_nonce: "nonce1", key_nonce: "key1" } });
      case "/api/v1/accounts/current_user/":
        return reply({ status: 200, body: { status: "ok", user: { pk: 123, username: "example" } } });
    }
    if (action === "com.bloks.www.bloks.caa.login.process_client_data_and_redirect") {
      return reply({
        status: 200,
        body: { status: "ok", layout: { bloks_payload: { data: [{ data: { key: "CAA_ACCOUNT_ACCESS_CONTEXT:aac", initial: AAC } }] } } },
        headers: { "ig-set-x-mid": "MID-from-bloks" },
      });
    }
    if (action) return reply({ status: 200, body: { status: "ok" } });
    return reply({ status: 404, body: { status: "fail", message: `unexpected ${url.pathname}` } });
  };
  const sequence = () => requests.map((r) => `${r.method} ${r.host}${r.path.replace("/api/v1/bloks/", "/bloks/")}`);
  return { transport, requests, sequence };
}

const params = (rec: Recorded) => JSON.parse(rec.form?.params ?? "{}");
const SEND_LOGIN = "com.bloks.www.bloks.caa.login.async.send_login_request";

function decryptPassword(encrypted: string): string {
  const [, , timestamp, payload] = encrypted.split(":");
  const bytes = Buffer.from(payload, "base64");
  const rsaLength = bytes.readUInt16LE(14);
  const padded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, bytes.subarray(16, 16 + rsaLength));
  const sessionKey = padded.subarray(padded.indexOf(0, 2) + 1);
  const decipher = createDecipheriv("aes-256-gcm", sessionKey, bytes.subarray(2, 14));
  decipher.setAAD(Buffer.from(timestamp));
  decipher.setAuthTag(bytes.subarray(16 + rsaLength, 32 + rsaLength));
  return Buffer.concat([decipher.update(bytes.subarray(32 + rsaLength)), decipher.final()]).toString("utf8");
}

describe("CaaLogin", () => {
  it("logs in with the password in one submission, after the device and account preflight", async () => {
    const ig = fakeInstagram({ [SEND_LOGIN]: () => ({ status: 200, body: successAction() }) });
    const client = new InstagramClient({ transport: ig.transport });

    await expect(new CaaLogin(client, 0).start("example", "s3cret-pässword")).resolves.toEqual({ status: "logged_in" });

    expect(ig.sequence()).toEqual([
      "POST i.instagram.com/api/v1/launcher/sync/",
      "POST b.i.instagram.com/graphql_www",
      "POST b.i.instagram.com/bloks/async_action/com.bloks.www.bloks.caa.login.process_client_data_and_redirect/",
      "POST b.i.instagram.com/api/v1/attestation/create_android_keystore/",
      "POST b.i.instagram.com/bloks/async_action/com.bloks.www.caa.login.oauth.token.fetch.async/",
      `POST b.i.instagram.com/bloks/async_action/${SEND_LOGIN}/`,
    ]);
    const [launcher, gql, pcd, keystore, oauth, send] = ig.requests;
    for (const rec of ig.requests) expect(rec.headers.Authorization).toBeUndefined();
    expect(launcher.body).toMatch(/^signed_body=SIGNATURE\./);
    expect(gql.headers["X-Client-Doc-Id"]).toBe("124930351917786857261002920888");
    expect(pcd.headers["X-Meta-Usdid"]).toMatch(/^[0-9a-f-]{36}\.\d+\./);
    expect(pcd.headers["X-MID"]).toBe("MID-from-launcher");
    expect(keystore.form).toEqual({ app_scoped_device_id: client.device.uuid, key_hash: "" });
    for (const rec of [pcd, oauth, send]) {
      expect(Object.keys(rec.form ?? {})).toEqual(["params", "_uuid", "bk_client_context", "bloks_versioning_id"]);
    }
    expect(params(oauth).client_input_params).toMatchObject({ aac: AAC, username_input: "example" });
    expect(params(pcd).waterfall_id).toBe(params(send).server_params.waterfall_id);

    const sent = params(send).client_input_params;
    expect(sent).toMatchObject({ aac: AAC, contact_point: "example", machine_id: "MID-from-bloks", password_contains_non_ascii: "true" });
    expect(decryptPassword(sent.password)).toBe("s3cret-pässword");
    expect(JSON.parse(send.headers["X-IG-Attest-Params"])).toEqual({
      attestation: [{ version: 2, type: "keystore", errors: [-1013], challenge_nonce: "nonce1", signed_nonce: "", key_hash: "" }],
    });

    expect(client.hasSession).toBe(true);
    expect(client.userId).toBe("123");
    expect(client.username).toBe("example");
    expect(client.serialize()).toMatchObject({ authorization: AUTH, rur: "RUR,123,1:token", wwwClaim: "hmac.claim" });
    expect(client.serialize().usdid?.registered).toBe(true);
  });

  it("does not register the device again once it is registered", async () => {
    const ig = fakeInstagram({ [SEND_LOGIN]: () => ({ status: 200, body: successAction() }) });
    const client = new InstagramClient({ transport: ig.transport });
    await new CaaLogin(client, 0).start("example", "pw");
    const restored = new InstagramClient({ transport: ig.transport, session: client.serialize() });
    ig.requests.length = 0;
    await new CaaLogin(restored, 0).start("example", "pw");
    expect(ig.sequence()).not.toContain("POST b.i.instagram.com/graphql_www");
  });

  it("sends no password when the device registration is not confirmed", async () => {
    const ig = fakeInstagram({}, { usdidOk: false });
    const client = new InstagramClient({ transport: ig.transport });
    await expect(new CaaLogin(client, 0).start("example", "pw")).rejects.toThrow(/no password was sent/);
    expect(ig.sequence().some((line) => line.includes(SEND_LOGIN))).toBe(false);
  });

  it("opens the profile-code screen, then submits the code", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate(AP_2SV_ENTRYPOINT, "context_data", "ctx-entry", { note: "email_challenge" }) }),
      [AP_2SV_ENTRYPOINT]: () => ({ status: 200, body: navigate(AP_2SV_CODE_ENTRY, "context_data", "ctx-code") }),
      [AP_2SV_CODE_ENTRY]: () => ({ status: 200, body: navigate(AP_2SV_CODE_ENTRY_ASYNC, "context_data", "ctx-submit") }),
      [AP_2SV_CODE_ENTRY_ASYNC]: () => ({ status: 200, body: successAction() }),
    });
    const client = new InstagramClient({ transport: ig.transport });
    const caa = new CaaLogin(client, 0);

    const started = await caa.start("example", "pw");
    expect(started).toMatchObject({ status: "two_factor", pending: { route: "profile_code", context: "ctx-submit", delivery: "email" } });
    expect(ig.sequence().slice(6)).toEqual([
      `POST b.i.instagram.com/bloks/async_action/${AP_2SV_ENTRYPOINT}/`,
      `POST b.i.instagram.com/bloks/apps/${AP_2SV_CODE_ENTRY}/`,
    ]);
    expect(client.hasSession).toBe(false);

    if (started.status !== "two_factor") throw new Error("expected two_factor");
    await caa.submitCode(started.pending, " 654 321 ");
    const submit = ig.requests[ig.requests.length - 1];
    expect(submit.path).toContain(AP_2SV_CODE_ENTRY_ASYNC);
    expect(params(submit).client_input_params).toMatchObject({ code: "654321", aac: AAC });
    expect(params(submit).server_params.context_data).toBe("ctx-submit");
    expect(client.hasSession).toBe(true);
  });

  it("runs the two-step route for an SMS code and switches to backup codes for 8 digits", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({
        status: 200,
        body: navigate("com.bloks.www.two_step_verification.entrypoint", "two_step_verification_context", "ctx-2sv", {
          two_factor_info: { sms_two_factor_on: true, totp_two_factor_on: false },
        }),
      }),
      "com.bloks.www.two_step_verification.verify_code.async": () => ({ status: 200, body: successAction() }),
    });
    const client = new InstagramClient({ transport: ig.transport });
    const caa = new CaaLogin(client, 0);

    const started = await caa.start("example", "pw");
    if (started.status !== "two_factor") throw new Error("expected two_factor");
    expect(started.pending).toMatchObject({ route: "two_step_verification", method: "sms", context: "ctx-2sv", delivery: "sms" });
    const navigation = ig.requests.find((r) => r.path.includes("method_picker.navigation.async"));
    expect(params(navigation!).client_input_params.selected_method).toBe("sms");

    await caa.submitCode(started.pending, "1234-5678");
    const tail = ig.sequence().slice(-3);
    expect(tail).toEqual([
      "POST i.instagram.com/bloks/async_action/com.bloks.www.two_step_verification.method_picker.navigation.async/",
      "POST i.instagram.com/bloks/apps/com.bloks.www.two_factor_login.enter_backup_code/",
      "POST i.instagram.com/bloks/async_action/com.bloks.www.two_step_verification.verify_code.async/",
    ]);
    const verify = params(ig.requests[ig.requests.length - 1]);
    expect(verify.client_input_params.code).toBe("12345678");
    expect(verify.server_params).toMatchObject({ challenge: "backup_codes", two_step_verification_context: "ctx-2sv" });
    expect(client.hasSession).toBe(true);
  });

  it("reports a code Instagram does not accept", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate("com.bloks.www.two_step_verification.entrypoint", "two_step_verification_context", "ctx") }),
    });
    const client = new InstagramClient({ transport: ig.transport });
    const caa = new CaaLogin(client, 0);
    const started = await caa.start("example", "pw");
    if (started.status !== "two_factor") throw new Error("expected two_factor");
    expect(started.pending.method).toBe("totp");
    await expect(caa.submitCode(started.pending, "000000")).rejects.toBeInstanceOf(IgTwoFactorCodeError);
  });

  it("fails without a session, naming what the response showed, after one submission", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: { status: "ok", layout: { bloks_payload: { action: '(dialog "Incorrect password")' } } } }),
    });
    const error = await new CaaLogin(new InstagramClient({ transport: ig.transport }), 0).start("example", "pw").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IgLoginFlowError);
    expect((error as Error).message).toContain('"incorrect password"');
    expect(ig.sequence().filter((line) => line.includes(SEND_LOGIN))).toHaveLength(1);
  });

  it("reports Instagram's request to fall back to the old login flow", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: { status: "ok", layout: { bloks_payload: { data: ["CAA_LOGIN_FALLBACK:accounts_login"] } } } }),
    });
    await expect(new CaaLogin(new InstagramClient({ transport: ig.transport }), 0).start("example", "pw")).rejects.toBeInstanceOf(
      IgLoginFallbackError
    );
  });

  it("reports Instagram's first-password-failure screen instead of a fallback", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({
        status: 200,
        body: {
          status: "ok",
          layout: {
            bloks_payload: {
              data: ["CAA_LOGIN_FALLBACK:fallback_triggered"],
              action: '(bk.action.caa "com.bloks.www.caa.ar.submit_code.async" "FIRST_PASSWORD_FAILURE")',
            },
          },
        },
      }),
    });
    const error = await new CaaLogin(new InstagramClient({ transport: ig.transport }), 0).start("example", "pw").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IgPasswordRejectedError);
    expect(error).not.toBeInstanceOf(IgLoginFallbackError);
    expect((error as Error).message).toContain("password is incorrect");
  });

  it("passes Instagram's typed errors through", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 400, body: { status: "fail", error_type: "bad_password", message: "wrong" } }),
    });
    await expect(new CaaLogin(new InstagramClient({ transport: ig.transport }), 0).start("example", "pw")).rejects.toBeInstanceOf(
      IgBadPasswordError
    );
  });
});

describe("IGPAPIClient password login", () => {
  const savedEnv = { IG_SESSION_DIR: process.env.IG_SESSION_DIR, IG_RATE_LIMITS: process.env.IG_RATE_LIMITS };
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "mcp-instagram-caa-"));
    process.env.IG_SESSION_DIR = dir;
    process.env.IG_RATE_LIMITS = '{"login":{"perMinute":100,"perHour":100,"perDay":100}}';
    resetRateLimiter();
    setConfig({ igpapi: {} });
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetRateLimiter();
    setConfig({ igpapi: {} });
    await fs.rm(dir, { recursive: true, force: true });
  });

  const manager = (ig: ReturnType<typeof fakeInstagram>) =>
    new IGPAPIClient({ createClient: (session) => new InstagramClient({ session, transport: ig.transport }), loginPaceMs: 0 });

  it("logs in, confirms the account and saves the session", async () => {
    const ig = fakeInstagram({ [SEND_LOGIN]: () => ({ status: 200, body: successAction() }) });
    const m = manager(ig);
    await m.login("example", "pw");
    expect(m.isLoggedIn()).toBe(true);
    expect(m.getUsername()).toBe("example");
    const saved = await loadSession();
    expect(saved?.authorization).toEqual(AUTH);
    expect(saved?.usdid?.registered).toBe(true);
    expect(ig.sequence()[ig.sequence().length - 1]).toBe("GET i.instagram.com/api/v1/accounts/current_user/?edit=true");
  });

  it("throws the pending two-factor info, then completes with the code", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate(AP_2SV_ENTRYPOINT, "context_data", "ctx-entry", { note: "email_challenge" }) }),
      [AP_2SV_ENTRYPOINT]: () => ({ status: 200, body: navigate(AP_2SV_CODE_ENTRY, "context_data", "ctx-code") }),
      [AP_2SV_CODE_ENTRY]: () => ({ status: 200, body: navigate(AP_2SV_CODE_ENTRY_ASYNC, "context_data", "ctx-submit") }),
      [AP_2SV_CODE_ENTRY_ASYNC]: () => ({ status: 200, body: successAction() }),
    });
    const m = manager(ig);
    const thrown = await m.login("example", "pw").catch((e: unknown) => e);
    expect(thrown).toMatchObject({ username: "example", twoFactorIdentifier: "profile_code", delivery: "email" });
    expect(m.hasPendingTwoFactor()).toBe(true);
    expect(m.isLoggedIn()).toBe(false);

    await m.completeTwoFactorLogin("123456");
    expect(m.isLoggedIn()).toBe(true);
    expect(m.hasPendingTwoFactor()).toBe(false);
    expect((await loadSession())?.authorization).toEqual(AUTH);
  });

  it("clears the pending login when the code is rejected", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate("com.bloks.www.two_step_verification.entrypoint", "two_step_verification_context", "ctx") }),
    });
    const m = manager(ig);
    await m.login("example", "pw").catch(() => undefined);
    await expect(m.completeTwoFactorLogin("000000")).rejects.toBeInstanceOf(IgTwoFactorCodeError);
    expect(m.hasPendingTwoFactor()).toBe(false);
    await expect(m.completeTwoFactorLogin("000000")).rejects.toThrow(/No pending 2FA login/);
  });

  it("leaves no pending two-factor state when the session cannot be saved", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate("com.bloks.www.two_step_verification.entrypoint", "two_step_verification_context", "ctx") }),
      "com.bloks.www.two_step_verification.verify_code.async": () => ({ status: 200, body: successAction() }),
    });
    const m = manager(ig);
    await m.login("example", "pw").catch(() => undefined);
    expect(m.hasPendingTwoFactor()).toBe(true);

    // Make saving fail: the session directory path runs through a regular file.
    const blocker = join(dir, "blocker");
    await fs.writeFile(blocker, "");
    process.env.IG_SESSION_DIR = join(blocker, "sessions");
    const original = console.error;
    console.error = () => undefined;
    try {
      await expect(m.completeTwoFactorLogin("123456")).rejects.toThrow(/Failed to save session/);
    } finally {
      console.error = original;
    }
    expect(m.hasPendingTwoFactor()).toBe(false);
    expect(m.getTwoFactorInfo()).toBeNull();
    expect(m.isLoggedIn()).toBe(false);
    await expect(m.completeTwoFactorLogin("123456")).rejects.toThrow(/No pending 2FA login/);

    // After fixing the problem, a new login works.
    process.env.IG_SESSION_DIR = dir;
    await m.login("example", "pw").catch(() => undefined);
    await m.completeTwoFactorLogin("123456");
    expect(m.isLoggedIn()).toBe(true);
  });

  it("captures redacted login-flow responses for unknown screens when IG_DEBUG_CAPTURE is set", async () => {
    const captureDir = join(dir, "capture");
    process.env.IG_DEBUG_CAPTURE = captureDir;
    const original = console.error;
    console.error = () => undefined;
    try {
      const ig = fakeInstagram({
        [SEND_LOGIN]: () => ({
          status: 200,
          body: {
            status: "ok",
            layout: { bloks_payload: { data: ["CAA_LOGIN_FALLBACK:fallback_triggered"], action: `t ${formatAuthorizationHeader(AUTH)} sessionid=123%3Asecret "sessionid":"123%3Asecret2"` } },
          },
        }),
      });
      await expect(manager(ig).login("example", "pw-not-in-capture")).rejects.toBeInstanceOf(IgLoginFallbackError);
    } finally {
      console.error = original;
      delete process.env.IG_DEBUG_CAPTURE;
    }
    const files = await fs.readdir(captureDir);
    expect(files).toHaveLength(1);
    const file = join(captureDir, files[0]);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const text = await fs.readFile(file, "utf8");
    const capture = JSON.parse(text);
    expect(capture.error).toContain("IgLoginFallbackError");
    expect(capture.responses.map((r: { path: string }) => r.path)).toContain(`bloks/async_action/${SEND_LOGIN}/`);
    expect(text).not.toContain("secret");
    expect(text).not.toContain(formatAuthorizationHeader(AUTH).slice(13));
    expect(text).not.toContain("pw-not-in-capture");
  });

  it("writes nothing without IG_DEBUG_CAPTURE", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: { status: "ok", layout: { bloks_payload: { data: ["CAA_LOGIN_FALLBACK:x"] } } } }),
    });
    await expect(manager(ig).login("example", "pw")).rejects.toBeInstanceOf(IgLoginFallbackError);
    expect((await fs.readdir(dir)).filter((name) => name.startsWith("caa-") || name === "capture")).toEqual([]);
  });

  it("drops a pending login on logout", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate("com.bloks.www.two_step_verification.entrypoint", "two_step_verification_context", "ctx") }),
    });
    const m = manager(ig);
    await m.login("example", "pw").catch(() => undefined);
    await m.logout();
    expect(m.hasPendingTwoFactor()).toBe(false);
  });
});

describe("hardening", () => {
  it("stops a password login before submitting it once the login was cancelled", async () => {
    let current = true;
    const ig = fakeInstagram({
      "com.bloks.www.caa.login.oauth.token.fetch.async": () => {
        current = false; // a logout happens during the preflight
        return { status: 200, body: { status: "ok" } };
      },
    });
    const caa = new CaaLogin(new InstagramClient({ transport: ig.transport }), 0, () => current);
    await expect(caa.start("example", "pw")).rejects.toThrow("Login was cancelled by a logout.");
    expect(ig.sequence().some((line) => line.includes(SEND_LOGIN))).toBe(false);
  });

  it("judges the login payload, not session state the client already had", async () => {
    const ig = fakeInstagram({
      [SEND_LOGIN]: () => ({ status: 200, body: navigate("com.bloks.www.two_step_verification.entrypoint", "two_step_verification_context", "ctx") }),
      "com.bloks.www.two_step_verification.verify_code.async": () => ({
        status: 200,
        body: { status: "ok", layout: { bloks_payload: { action: `x(${pyDumps(pyDumps({ login_response: "{}", headers: "{}", cookies: "" }))})` } } },
      }),
    });
    const client = new InstagramClient({ transport: ig.transport });
    const caa = new CaaLogin(client, 0);
    const started = await caa.start("example", "pw");
    if (started.status !== "two_factor") throw new Error("expected two_factor");
    client.setAuthorization(AUTH); // e.g. installed by another flow
    await expect(caa.submitCode(started.pending, "123456")).rejects.toBeInstanceOf(IgTwoFactorCodeError);
  });

  it("parses hostile bloks programs in linear time", async () => {
    const { extractLoginResponse, extractContextData } = await import("../instagram/index.js");
    const hostile = '"\\"'.repeat(60_000); // many unterminated / invalid literals
    const startedAt = Date.now();
    expect(extractLoginResponse({ layout: { bloks_payload: { action: hostile } } })).toBeNull();
    expect(extractContextData({ action: hostile }, "com.bloks.www.x")).toBe("");
    expect(Date.now() - startedAt).toBeLessThan(1000);
    let deep: unknown = "leaf";
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(() => extractLoginResponse({ layout: { bloks_payload: { data: deep } } })).not.toThrow();
  });

  it("rejects session files whose header values contain control characters", async () => {
    const { sessionStateFromJson } = await import("../instagram/index.js");
    const valid = new InstagramClient({ transport: fakeInstagram().transport }).serialize();
    expect(sessionStateFromJson({ ...valid, device: { ...valid.device, model: "Pixel\r\nX-Evil: 1" } })).toBeNull();
    const cleaned = sessionStateFromJson({ ...valid, mid: "a\nb", cookies: { ok: "1", "bad;name": "x", evil: "a\r\nb" } });
    expect(cleaned?.mid).toBeUndefined();
    expect(cleaned?.cookies).toEqual({ ok: "1" });
  });
});
