/**
 * Reading saved sessions: the current format (SessionState v2) and files
 * written by instagram-private-api (mcp-instagram <= 0.1), whose cookies and
 * device identifiers are carried over so Instagram keeps seeing the same
 * device and the user stays logged in.
 */

import { createDeviceProfile } from "./device.js";
import { parseAuthorizationHeader } from "./client.js";
import type { AuthorizationData, DeviceProfile, SessionState } from "./types.js";

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const DEVICE_STRING_KEYS: Array<keyof DeviceProfile> = [
  "appVersion", "versionCode", "bloksVersionId", "androidRelease", "dpi", "resolution",
  "manufacturer", "model", "device", "cpu", "locale", "uuid", "phoneId", "androidId", "adid",
];

function isDeviceProfile(value: unknown): value is DeviceProfile {
  return (
    isObject(value) &&
    DEVICE_STRING_KEYS.every((key) => isString(value[key])) &&
    typeof value.androidVersion === "number" &&
    typeof value.timezoneOffset === "number"
  );
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") out[key] = item;
    }
  }
  return out;
}

function authorizationFrom(value: unknown): AuthorizationData | undefined {
  if (isObject(value) && isString(value.sessionid) && (isString(value.ds_user_id) || typeof value.ds_user_id === "number")) {
    return { ...value, sessionid: value.sessionid, ds_user_id: String(value.ds_user_id) };
  }
  return undefined;
}

/** Cookies from a serialized tough-cookie jar (instagram-private-api), Instagram domains only, unexpired. */
function cookiesFromToughCookieJar(serialized: unknown, now: number): Record<string, string> {
  let jar: unknown = serialized;
  if (typeof jar === "string") {
    try {
      jar = JSON.parse(jar);
    } catch {
      return {};
    }
  }
  const out: Record<string, string> = {};
  const cookies = isObject(jar) && Array.isArray(jar.cookies) ? jar.cookies : [];
  for (const cookie of cookies) {
    if (!isObject(cookie) || !isString(cookie.key) || typeof cookie.value !== "string") continue;
    const domain = typeof cookie.domain === "string" ? cookie.domain : "";
    if (domain && !domain.endsWith("instagram.com")) continue;
    if (typeof cookie.expires === "string" && cookie.expires !== "Infinity" && Date.parse(cookie.expires) <= now) continue;
    out[cookie.key] = cookie.value;
  }
  return out;
}

function fromInstagramPrivateApi(raw: Json, now: number): SessionState | null {
  const cookies = cookiesFromToughCookieJar(raw.cookies, now);
  const authorization =
    parseAuthorizationHeader(typeof raw.authorization === "string" ? raw.authorization : undefined) ??
    (cookies.sessionid && cookies.ds_user_id
      ? { ds_user_id: cookies.ds_user_id, sessionid: cookies.sessionid, should_use_header_over_cookies: true }
      : undefined);
  if (!authorization && !cookies.sessionid) {
    return null;
  }

  const device = createDeviceProfile();
  if (isString(raw.uuid)) device.uuid = raw.uuid;
  if (isString(raw.phoneId)) device.phoneId = raw.phoneId;
  if (isString(raw.deviceId) && raw.deviceId.startsWith("android-")) device.androidId = raw.deviceId;
  if (isString(raw.adid)) device.adid = raw.adid;

  return {
    version: 2,
    device,
    cookies,
    ...(authorization ? { authorization, userId: authorization.ds_user_id } : {}),
    ...(cookies.mid ? { mid: cookies.mid } : {}),
    ...(isString(raw.igWWWClaim) ? { wwwClaim: raw.igWWWClaim } : {}),
  };
}

/**
 * Converts parsed session.json contents to a SessionState, or null when the
 * contents are not a session this server can use.
 */
export function sessionStateFromJson(raw: unknown, now: number = Date.now()): SessionState | null {
  if (!isObject(raw)) return null;
  if (raw.version === 2) {
    if (!isDeviceProfile(raw.device)) return null;
    const authorization = authorizationFrom(raw.authorization);
    return {
      version: 2,
      device: raw.device,
      cookies: stringRecord(raw.cookies),
      ...(authorization ? { authorization } : {}),
      ...(isString(raw.mid) ? { mid: raw.mid } : {}),
      ...(isString(raw.rur) ? { rur: raw.rur } : {}),
      ...(isString(raw.wwwClaim) ? { wwwClaim: raw.wwwClaim } : {}),
      ...(isString(raw.importedSessionId) ? { importedSessionId: raw.importedSessionId } : {}),
      ...(isString(raw.userId) ? { userId: raw.userId } : {}),
      ...(isString(raw.username) ? { username: raw.username } : {}),
    };
  }
  if ("cookies" in raw && ("deviceString" in raw || "constants" in raw)) {
    return fromInstagramPrivateApi(raw, now);
  }
  return null;
}
