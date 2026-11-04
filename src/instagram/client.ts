/**
 * Minimal Instagram private-API client (Android app emulation).
 *
 * Replaces instagram-private-api. Request/response handling is ported from
 * instagrapi (MIT, see NOTICE). Unlike instagram-private-api, TLS certificates
 * are always verified.
 */

import { randomUUID } from "node:crypto";
import { Agent, fetch as undiciFetch } from "undici";
import { APP_ID, createDeviceProfile, userAgent, withCurrentAppProfile } from "./device.js";
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
  /** Injected for tests; defaults to undici's fetch with an HTTP/2-capable agent. */
  fetch?: typeof fetch;
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
  private readonly fetchImpl: typeof fetch;
  private readonly dispatcher?: Agent;

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
    if (options.fetch) {
      this.fetchImpl = options.fetch;
    } else {
      // allowH2 offers HTTP/2 via ALPN, as the app does. TLS is verified (undici default).
      // undici's own fetch, so the agent and fetch come from the same undici version.
      this.dispatcher = new Agent({ allowH2: true, connect: { timeout: this.timeoutMs } });
      this.fetchImpl = undiciFetch as unknown as typeof fetch;
    }
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
    };
  }

  /** Releases pooled connections. */
  async close(): Promise<void> {
    await this.dispatcher?.close();
  }

  /** Headers the Android app sends on every private-API request. */
  private baseHeaders(): Record<string, string> {
    const d = this.device;
    const lang = d.locale.replace("_", "-");
    const headers: Record<string, string> = {
      "User-Agent": userAgent(d),
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
      "X-FB-Client-IP": "True",
      "X-FB-Server-Cluster": "True",
      "IG-INTENDED-USER-ID": this.userIdValue ?? "0",
    };
    if (this.mid) headers["X-MID"] = this.mid;
    if (this.userIdValue) headers["IG-U-DS-USER-ID"] = this.userIdValue;
    if (this.rur) headers["IG-U-RUR"] = this.rur;
    if (this.authorization) headers.Authorization = formatAuthorizationHeader(this.authorization);
    const cookie = Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  /** Learns session state from Instagram's ig-set-* response headers and cookies. */
  private absorbResponse(headers: Headers): void {
    const auth = parseAuthorizationHeader(headers.get("ig-set-authorization"));
    if (auth) {
      this.authorization = auth;
      this.userIdValue = auth.ds_user_id;
    }
    const mid = headers.get("ig-set-x-mid");
    if (mid) this.mid = mid;
    const rur = headers.get("ig-set-ig-u-rur");
    if (rur) this.rur = rur;
    const claim = headers.get("x-ig-set-www-claim");
    if (claim) this.wwwClaim = claim;
    const dsUserId = headers.get("ig-set-ig-u-ds-user-id");
    if (dsUserId && dsUserId !== "0") this.userIdValue = dsUserId;
    const keyId = headers.get("ig-set-password-encryption-key-id");
    const publicKey = headers.get("ig-set-password-encryption-pub-key");
    if (keyId && publicKey && Number.isInteger(Number(keyId))) {
      this.passwordKey = { keyId: Number(keyId), publicKey };
    }
    applySetCookies(this.cookies, headers.getSetCookie?.() ?? []);
  }

  /**
   * Sends one private-API request and returns the parsed JSON body.
   * Throws an IgResponseError subclass for Instagram errors, IgNetworkError otherwise.
   */
  async request<T = Record<string, unknown>>(req: IgRequest): Promise<T> {
    const method = req.method ?? (req.form ? "POST" : "GET");
    const url = new URL(`https://${API_HOST}/api/v1/${req.path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { ...this.baseHeaders(), ...(req.headers ?? {}) };
    let body: string | undefined;
    if (method === "POST") {
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      const form = req.form ?? {};
      const params = new URLSearchParams();
      if (req.signed ?? true) {
        params.set("signed_body", `SIGNATURE.${JSON.stringify(form)}`);
      } else {
        for (const [key, value] of Object.entries(form)) {
          if (value !== undefined) params.set(key, typeof value === "string" ? value : JSON.stringify(value));
        }
      }
      body = params.toString();
    }

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
      } as RequestInit);
      text = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new IgNetworkError(`${method} ${req.path} failed: ${reason}`, { cause: error });
    }

    this.absorbResponse(response.headers);

    let parsed: Record<string, unknown> | undefined;
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }

    const info: IgResponseInfo = { status: response.status, path: req.path, body: parsed ?? {} };
    if (!response.ok) {
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
