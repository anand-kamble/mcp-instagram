/**
 * Minimal Instagram private-API client (Android app emulation).
 *
 * Replaces instagram-private-api. Request/response handling is ported from
 * instagrapi (MIT, see NOTICE). Unlike instagram-private-api, TLS certificates
 * are always verified.
 */

import { randomUUID } from "node:crypto";
import { APP_ID, createDeviceProfile, userAgent, withCurrentAppProfile } from "./device.js";
import { formEncode, signedBody } from "./encoding.js";
import { createH2Transport, fetchTransport } from "./transport.js";
import type { Transport } from "./transport.js";
import { createUsdid, UsdidHeader } from "./usdid.js";
import type { UsdidState } from "./usdid.js";
import {
  IgActionSpamError,
  IgBadPasswordError,
  IgCheckpointError,
  IgInvalidUserError,
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
} from "./errors.js";
import type { IgResponseInfo } from "./errors.js";
import type { PasswordEncryptionKey } from "./password.js";
import type { AuthorizationData, DeviceProfile, IgRequest, SessionState } from "./types.js";

export const API_HOST = "i.instagram.com";
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface InstagramClientOptions {
  /** Saved session to resume. A new device is generated when omitted. */
  session?: SessionState;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** HTTP transport; defaults to HTTP/2 over TLS 1.3 (createH2Transport). */
  transport?: Transport;
  /** Convenience for tests: a fetch implementation wrapped as the transport. */
  fetch?: typeof fetch;
}

/** Value of a header, matched case-insensitively. */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** Maps an Instagram error response to the matching error class. */
export function toIgError(info: IgResponseInfo, rawText = ""): IgResponseError {
  const message = typeof info.body.message === "string" ? info.body.message : "";
  const errorType = typeof info.body.error_type === "string" ? info.body.error_type : "";

  if (info.status === 404 && rawText.trim() === "Not Found") {
    // Instagram masks some challenges as a bare "Not Found" body.
    return new IgCheckpointError(info, `${info.path} - Instagram requires a security check (masked challenge)`);
  }
  if (message === "login_required") return new IgLoginRequiredError(info);
  if (message === "user_has_logged_out") return new IgUserHasLoggedOutError(info);
  if (message === "challenge_required" || errorType === "challenge_required") return new IgCheckpointError(info);
  if (message.includes("Please wait a few minutes") || errorType === "rate_limit_error" || info.status === 429) {
    return new IgRateLimitedError(info);
  }
  if (message === "feedback_required") {
    const feedback = typeof info.body.feedback_message === "string" ? `: ${info.body.feedback_message}` : "";
    return new IgActionSpamError(info, `${info.path} - feedback_required${feedback}`);
  }
  if (errorType === "sentry_block") return new IgSentryBlockError(info);
  if (info.body.two_factor_info || errorType === "two_factor_required") return new IgTwoFactorRequiredError(info);
  if (errorType === "bad_password") return new IgBadPasswordError(info);
  if (errorType === "invalid_user") return new IgInvalidUserError(info);
  if (errorType === "needs_upgrade") return new IgNeedsUpgradeError(info);
  if (message.includes("Not authorized to view user")) return new IgPrivateUserError(info);
  if (
    info.status === 404 ||
    message.includes("Media is unavailable") ||
    message.includes("Media not found or unavailable") ||
    message.includes("has been deleted") ||
    message.includes("Invalid media_id")
  ) {
    return new IgNotFoundError(info);
  }
  return new IgResponseError(info);
}

/**
 * JSON.parse that keeps integers beyond Number.MAX_SAFE_INTEGER exact by
 * turning them into strings. Instagram sends 19-digit media and comment ids as
 * JSON numbers; plain JSON.parse would round them and later requests would
 * target the wrong object. (Node 22 lacks JSON.parse source-text access.)
 */
export function parseJsonPreservingBigInts(text: string): unknown {
  let out = "";
  let last = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      let end = i + 1;
      while (end < text.length && /[0-9.eE+-]/.test(text[end])) end++;
      const token = text.slice(i, end);
      if (/^-?\d{16,}$/.test(token) && !Number.isSafeInteger(Number(token))) {
        out += `${text.slice(last, i)}"${token}"`;
        last = end;
      }
      i = end - 1;
    }
  }
  return JSON.parse(last === 0 ? text : out + text.slice(last));
}

/** Parses `Bearer IGT:2:<base64 JSON>`; returns undefined for anything without a session id. */
export function parseAuthorizationHeader(value: string | null | undefined): AuthorizationData | undefined {
  if (!value) return undefined;
  const b64 = value.slice(value.lastIndexOf(":") + 1);
  if (!b64) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (parsed && typeof parsed === "object" && typeof (parsed as AuthorizationData).sessionid === "string") {
      const data = parsed as AuthorizationData;
      return data.sessionid && data.ds_user_id ? { ...data, ds_user_id: String(data.ds_user_id) } : undefined;
    }
  } catch {
    // Not an IGT:2 token.
  }
  return undefined;
}

export function formatAuthorizationHeader(data: AuthorizationData): string {
  return `Bearer IGT:2:${Buffer.from(JSON.stringify(data), "utf8").toString("base64")}`;
}

/** Applies Set-Cookie headers to a name -> value jar (all Instagram cookies share one domain). */
export function applySetCookies(jar: Record<string, string>, setCookies: string[], now = Date.now()): void {
  for (const header of setCookies) {
    const [pair, ...attributes] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    let expired = value === "" || value === '""';
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.trim().split("=");
      const attrValue = rest.join("=");
      if (key.toLowerCase() === "max-age" && Number(attrValue) <= 0) expired = true;
      if (key.toLowerCase() === "expires") {
        const at = Date.parse(attrValue);
        if (!Number.isNaN(at) && at <= now) expired = true;
      }
    }
    if (expired) delete jar[name];
    else jar[name] = value;
  }
}

export class InstagramClient {
  readonly device: DeviceProfile;
  private readonly cookies: Record<string, string>;
  private authorization?: AuthorizationData;
  private mid?: string;
  private rur?: string;
  private wwwClaim?: string;
  private userIdValue?: string;
  private usernameValue?: string;
  private passwordKey?: PasswordEncryptionKey;
  private readonly pigeonSessionId = `UFS-${randomUUID()}-1`;
  private readonly timeoutMs: number;
  private readonly transport: Transport;
  private usdidState?: UsdidState;
  private usdidHeader?: UsdidHeader;

  constructor(options: InstagramClientOptions = {}) {
    const session = options.session;
    this.device = session ? withCurrentAppProfile(session.device) : createDeviceProfile();
    this.cookies = { ...(session?.cookies ?? {}) };
    this.authorization = session?.authorization;
    this.mid = session?.mid;
    this.rur = session?.rur;
    this.wwwClaim = session?.wwwClaim;
    this.userIdValue = session?.userId ?? session?.authorization?.ds_user_id;
    this.usernameValue = session?.username;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transport = options.transport ?? (options.fetch ? fetchTransport(options.fetch) : createH2Transport());
    if (session?.usdid) {
      this.usdidState = { ...session.usdid };
      this.usdidHeader = new UsdidHeader(this.usdidState);
    }
  }

  /** X-MID / machine_id, once Instagram has assigned one. */
  get machineId(): string | undefined {
    return this.mid;
  }

  /** The device's USDID key, created on first use. */
  ensureUsdid(): UsdidState {
    if (!this.usdidState) {
      this.usdidState = createUsdid();
      this.usdidHeader = new UsdidHeader(this.usdidState);
    }
    return this.usdidState;
  }

  markUsdidRegistered(): void {
    if (this.usdidState) this.usdidState.registered = true;
  }

  /** Numeric id of the logged-in account, if any. */
  get userId(): string | undefined {
    return this.userIdValue;
  }

  get username(): string | undefined {
    return this.usernameValue;
  }

  /** True when the client holds session credentials (not whether Instagram still accepts them). */
  get hasSession(): boolean {
    return Boolean(this.authorization?.sessionid ?? this.cookies.sessionid);
  }

  /** Last password-encryption key announced by Instagram (ig-set-password-encryption-*). */
  get passwordEncryptionKey(): PasswordEncryptionKey | undefined {
    return this.passwordKey;
  }

  /** Common device fields many POST forms include. */
  get deviceFields(): { _uuid: string; device_id: string; _uid?: string } {
    return {
      _uuid: this.device.uuid,
      device_id: this.device.androidId,
      ...(this.userIdValue ? { _uid: this.userIdValue } : {}),
    };
  }

  /** Records who is logged in (e.g. after verifying a session). */
  setAccount(userId: string, username?: string): void {
    this.userIdValue = userId;
    if (username) this.usernameValue = username;
  }

  /** Installs session credentials obtained elsewhere (login flow or a browser sessionid). */
  setAuthorization(data: AuthorizationData): void {
    this.authorization = { ...data, ds_user_id: String(data.ds_user_id) };
    this.userIdValue = this.authorization.ds_user_id;
    this.cookies.sessionid = data.sessionid;
    this.cookies.ds_user_id = this.authorization.ds_user_id;
  }

  /** Drops credentials and account state; the device profile is kept. */
  clearSession(): void {
    this.authorization = undefined;
    this.userIdValue = undefined;
    this.usernameValue = undefined;
    this.rur = undefined;
    this.wwwClaim = undefined;
    for (const name of Object.keys(this.cookies)) delete this.cookies[name];
  }

  serialize(): SessionState {
    return {
      version: 2,
      device: { ...this.device },
      cookies: { ...this.cookies },
      ...(this.authorization ? { authorization: { ...this.authorization } } : {}),
      ...(this.mid ? { mid: this.mid } : {}),
      ...(this.rur ? { rur: this.rur } : {}),
      ...(this.wwwClaim ? { wwwClaim: this.wwwClaim } : {}),
      ...(this.userIdValue ? { userId: this.userIdValue } : {}),
      ...(this.usernameValue ? { username: this.usernameValue } : {}),
      ...(this.usdidState ? { usdid: { ...this.usdidState } } : {}),
    };
  }

  /** Releases pooled connections. */
  async close(): Promise<void> {
    await this.transport.close?.();
  }

  /** Headers the Android app sends on every private-API request. */
  private baseHeaders(): Record<string, string> {
    const d = this.device;
    const lang = d.locale.replace("_", "-");
    const headers: Record<string, string> = {
      "User-Agent": userAgent(d),
      Accept: "*/*",
      "Accept-Language": lang === "en-US" ? "en-US" : `${lang}, en-US`,
      "X-IG-App-Locale": d.locale,
      "X-IG-Device-Locale": d.locale,
      "X-IG-Mapped-Locale": d.locale,
      "X-Pigeon-Session-Id": this.pigeonSessionId,
      "X-Pigeon-Rawclienttime": (Date.now() / 1000).toFixed(3),
      "X-IG-Bandwidth-Speed-KBPS": "-1.000",
      "X-IG-Bandwidth-TotalBytes-B": "0",
      "X-IG-Bandwidth-TotalTime-MS": "0",
      "X-IG-App-Startup-Country": "US",
      "X-Bloks-Version-Id": d.bloksVersionId,
      "X-IG-WWW-Claim": this.wwwClaim ?? "0",
      "X-Bloks-Is-Layout-RTL": "false",
      "X-Bloks-Is-Panorama-Enabled": "true",
      "X-IG-Device-ID": d.uuid,
      "X-IG-Family-Device-ID": d.phoneId,
      "X-IG-Android-ID": d.androidId,
      "X-IG-Timezone-Offset": String(d.timezoneOffset),
      "X-IG-Connection-Type": "WIFI",
      "X-IG-Capabilities": "3brTv10=",
      "X-IG-App-ID": APP_ID,
      Priority: "u=3",
      "Accept-Encoding": "gzip, deflate",
      "X-FB-HTTP-Engine": "Tigon/MNS/TCP",
      "X-Tigon-Is-Retry": "False",
      "X-Zero-Balance": "INIT",
      "X-Zero-State": "unknown",
      "Zero-HTTP-Network-Interface": "wifi",
      "X-FB-Client-IP": "True",
      "X-FB-Server-Cluster": "True",
      "IG-INTENDED-USER-ID": this.userIdValue ?? "0",
      "X-IG-Nav-Chain": "9MV:self_profile:2,ProfileMediaTabFragment:self_profile:3,9Xf:self_following:4",
    };
    if (this.mid) headers["X-MID"] = this.mid;
    const uid = this.userIdValue;
    if (uid) {
      // instagrapi derives these region hints from the user id with fixed
      // suffixes (private.py:318-341); the server's ig-set-ig-u-rur wins.
      const now = Math.floor(Date.now() / 1000);
      const nextYear = now + 31_536_000;
      headers["IG-U-DS-USER-ID"] = uid;
      headers["IG-U-IG-DIRECT-REGION-HINT"] =
        `LLA,${uid},${nextYear}:01f7bae7d8b131877d8e0ae1493252280d72f6d0d554447cb1dc9049b6b2c507c08605b7`;
      headers["IG-U-SHBID"] =
        `12695,${uid},${nextYear}:01f778d9c9f7546cf3722578fbf9b85143cd6e5132723e5c93f40f55ca0459c8ef8a0d9f`;
      headers["IG-U-SHBTS"] =
        `${now},${uid},${nextYear}:01f7ace11925d0388080078d0282b75b8059844855da27e23c90a362270fddfb3fae7e28`;
      headers["IG-U-RUR"] =
        `RVA,${uid},${nextYear}:01f7f627f9ae4ce2874b2e04463efdb184340968b1b006fa88cb4cc69a942a04201e544c`;
    }
    if (this.rur) headers["IG-U-RUR"] = this.rur;
    if (this.usdidHeader) headers["X-Meta-Usdid"] = this.usdidHeader.value();
    if (this.authorization) headers.Authorization = formatAuthorizationHeader(this.authorization);
    const cookie = Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  /**
   * Learns session state from Instagram's ig-set-* headers and cookies, from a
   * response or from the login payload embedded in a CAA response.
   */
  absorbResponse(headers: Record<string, string>, setCookies: string[] = []): void {
    const auth = parseAuthorizationHeader(headerValue(headers, "ig-set-authorization"));
    if (auth) {
      this.authorization = auth;
      this.userIdValue = auth.ds_user_id;
    }
    const mid = headerValue(headers, "ig-set-x-mid");
    if (mid) this.mid = mid;
    const rur = headerValue(headers, "ig-set-ig-u-rur");
    if (rur) this.rur = rur;
    const claim = headerValue(headers, "x-ig-set-www-claim");
    if (claim) this.wwwClaim = claim;
    const dsUserId = headerValue(headers, "ig-set-ig-u-ds-user-id");
    if (dsUserId && dsUserId !== "0") this.userIdValue = dsUserId;
    const keyId = headerValue(headers, "ig-set-password-encryption-key-id");
    const publicKey = headerValue(headers, "ig-set-password-encryption-pub-key");
    if (keyId && publicKey && Number.isInteger(Number(keyId))) {
      this.passwordKey = { keyId: Number(keyId), publicKey };
    }
    applySetCookies(this.cookies, setCookies);
    if (!this.mid && this.cookies.mid) this.mid = this.cookies.mid;
    if (!this.userIdValue && this.cookies.sessionid && this.cookies.ds_user_id) {
      this.userIdValue = this.cookies.ds_user_id;
    }
  }

  /**
   * Sends one private-API request and returns the parsed JSON body.
   * Throws an IgResponseError subclass for Instagram errors, IgNetworkError otherwise.
   */
  async request<T = Record<string, unknown>>(req: IgRequest): Promise<T> {
    const method = req.method ?? (req.form ? "POST" : "GET");
    const host = req.domain ?? API_HOST;
    const path = req.path.startsWith("/") ? req.path : `/api/v1/${req.path}`;
    const url = new URL(`https://${host}${path}`);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { ...this.baseHeaders(), ...(req.headers ?? {}) };
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      const form = req.form ?? {};
      body = (req.signed ?? true) ? signedBody(form) : formEncode(form);
    }

    let response;
    try {
      response = await this.transport({
        method,
        url: url.href,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IgNetworkError(`${method} ${req.path} failed: ${reason}`, { cause: error });
    }

    this.absorbResponse(response.headers, response.setCookie);
    const text = response.body;

    const parseObject = (candidate: string): Record<string, unknown> | undefined => {
      try {
        const value: unknown = parseJsonPreservingBigInts(candidate);
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    let parsed = parseObject(text);
    if (!parsed && req.ndjson) {
      // GraphQL may answer with NDJSON; the first line carries the result.
      const firstLine = text.split(/\r?\n/).find((line) => line.trim());
      if (firstLine) parsed = parseObject(firstLine);
    }

    const info: IgResponseInfo = { status: response.status, path: req.path, body: parsed ?? {} };
    if (response.status < 200 || response.status >= 300) {
      throw toIgError(info, text);
    }
    if (!parsed) {
      throw new IgNetworkError(`${method} ${req.path} returned a non-JSON response (HTTP ${response.status})`);
    }
    if (parsed.status === "fail") {
      throw toIgError(info, text);
    }
    return parsed as T;
  }

  /** Throws IgNoSessionError when there are no session credentials. */
  requireSession(): void {
    if (!this.hasSession) throw new IgNoSessionError();
  }
}
