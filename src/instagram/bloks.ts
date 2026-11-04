/**
 * Parsers for Instagram "bloks" responses used by the CAA login: account
 * access context (aac), screen context_data, two-step contexts and the login
 * payload embedded in a bloks action program.
 *
 * Pure functions ported 1:1 from instagrapi bloks.py / auth.py via the CAA
 * probe, where they were checked against instagrapi's own parsers and tests
 * (MIT, see NOTICE).
 */

import { pyDumps } from "./encoding.js";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Python truthiness for JSON values. */
const truthy = (value: unknown): boolean =>
  value !== null &&
  value !== undefined &&
  value !== false &&
  value !== 0 &&
  value !== "" &&
  !(Array.isArray(value) && value.length === 0) &&
  !(isObject(value) && Object.keys(value).length === 0);

export const AP_2SV_ENTRYPOINT = "com.bloks.www.ap.two_step_verification.entrypoint_async";
export const AP_2SV_CODE_ENTRY = "com.bloks.www.ap.two_step_verification.code_entry";
export const AP_2SV_CODE_ENTRY_ASYNC = "com.bloks.www.ap.two_step_verification.code_entry_async";

/** Every string anywhere in a JSON value. */
export function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > MAX_DEPTH) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out, depth + 1);
  else if (isObject(value)) for (const item of Object.values(value)) collectStrings(item, out, depth + 1);
  return out;
}

/** Strings longer than this are not scanned (real bloks programs are far smaller). */
const MAX_SCAN_LENGTH = 2_000_000;
/** Nesting deeper than this is not searched. */
const MAX_DEPTH = 256;

/**
 * Decodes the JSON string literal starting at text[start]. Returns its end
 * even when the literal is not valid JSON (value undefined), and null when
 * no closing quote follows, so callers never rescan the same text.
 */
function decodeJsonString(text: string, start: number): { value: unknown; end: number } | null {
  if (text[start] !== '"') return null;
  for (let i = start + 1; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 92) {
      i++;
      continue;
    }
    if (code === 34) {
      try {
        return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 };
      } catch {
        return { value: undefined, end: i + 1 };
      }
    }
  }
  return null;
}

/** bloks.py _find_bloks_value: depth-first search that also descends into JSON-looking strings. */
export function findBloksValue(data: unknown, key: string, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (isObject(data)) {
    const own = Object.hasOwn(data, key) ? data[key] : undefined;
    if (truthy(own)) return own;
    for (const child of Object.values(data)) {
      const found = findBloksValue(child, key, depth + 1);
      if (truthy(found)) return found;
    }
  } else if (Array.isArray(data)) {
    for (const child of data) {
      const found = findBloksValue(child, key, depth + 1);
      if (truthy(found)) return found;
    }
  } else if (typeof data === "string" && data.length < 10_000 && data.includes(key)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
    const found = findBloksValue(parsed, key, depth + 1);
    if (truthy(found)) return found;
  }
  return null;
}

/** auth.py _find_login_response_value: like findBloksValue without descending into strings. */
export function findLoginResponseValue(data: unknown, key: string, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;
  if (isObject(data)) {
    const own = Object.hasOwn(data, key) ? data[key] : undefined;
    if (truthy(own)) return own;
    for (const child of Object.values(data)) {
      const found = findLoginResponseValue(child, key, depth + 1);
      if (truthy(found)) return found;
    }
  } else if (Array.isArray(data)) {
    for (const child of data) {
      const found = findLoginResponseValue(child, key, depth + 1);
      if (truthy(found)) return found;
    }
  }
  return null;
}

function parenthesizedExpression(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return "";
}

function expressionItems(expression: string): string[] {
  if (!expression.startsWith("(") || !expression.endsWith(")")) return [];
  const items: string[] = [];
  let index = 1;
  while (index < expression.length - 1) {
    if (/\s/.test(expression[index])) {
      index++;
      continue;
    }
    let item: string;
    if (expression[index] === "(") {
      item = parenthesizedExpression(expression, index);
      if (!item) return [];
    } else if (expression[index] === '"') {
      const decoded = decodeJsonString(expression, index);
      if (!decoded || decoded.value === undefined) return [];
      item = expression.slice(index, decoded.end);
    } else {
      const atom = /^[^()\s"]+/.exec(expression.slice(index));
      if (!atom) return [];
      item = atom[0];
    }
    items.push(item);
    index += item.length;
  }
  return items;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * bloks.py _bloks_extract_context_value: the literal `contextKey` from the
 * static parameter map that follows a reference to `appId`, descending into a
 * literal `server_params` map.
 */
export function extractContextValue(result: unknown, appId: string, contextKey: string): string {
  const anchor = new RegExp(escapeRegExp(JSON.stringify(appId)), "g");
  const appReference = /(?<![_a-zA-Z0-9])com\.bloks\.[_a-zA-Z0-9.]+/g;
  for (const text of collectStrings(result)) {
    if (text.length > MAX_SCAN_LENGTH) continue;
    for (const found of text.matchAll(anchor)) {
      const foundEnd = (found.index ?? 0) + found[0].length;
      const mapStart = text.indexOf("(f4i", foundEnd);
      if (mapStart < 0) continue;
      appReference.lastIndex = foundEnd;
      const nextApp = appReference.exec(text);
      if (nextApp && nextApp.index < mapStart) continue;
      let expression = parenthesizedExpression(text, mapStart);
      while (expression) {
        const items = expressionItems(expression);
        if (items.length !== 3 || items[0] !== "f4i") break;
        const keys = expressionItems(items[1]);
        const values = expressionItems(items[2]);
        if (keys[0] !== "dkc" || values[0] !== "dkc" || keys.length !== values.length) break;
        expression = "";
        for (let i = 1; i < keys.length; i++) {
          const key = keys[i];
          const value = values[i];
          if (!key.startsWith('"')) continue;
          const name: unknown = JSON.parse(key);
          if (name === contextKey) {
            const parsed: unknown = value.startsWith('"') ? JSON.parse(value) : "";
            return typeof parsed === "string" ? parsed : "";
          }
          if (name === "server_params") expression = value;
        }
      }
    }
  }
  return "";
}

export const extractContextData = (result: unknown, appId: string): string =>
  extractContextValue(result, appId, "context_data");

export function extractTwoStepVerificationContext(result: unknown): string {
  const value = findBloksValue(result, "two_step_verification_context");
  if (typeof value === "string" && value.trim()) return value.trim();
  const action = bloksAction(result);
  if (action === undefined) return "";
  return extractContextValue(
    { action },
    "com.bloks.www.two_step_verification.entrypoint",
    "two_step_verification_context"
  ).trim();
}

export const needsProfileCode = (result: unknown): boolean =>
  collectStrings(result).join("\n").includes(AP_2SV_ENTRYPOINT);

function bloksPayload(result: unknown): Json | undefined {
  const layout = isObject(result) ? result.layout : undefined;
  const payload = isObject(layout) ? layout.bloks_payload : undefined;
  return isObject(payload) ? payload : undefined;
}

function bloksAction(result: unknown): string | undefined {
  const action = bloksPayload(result)?.action;
  return typeof action === "string" ? action : undefined;
}

/** bloks.py bloks_extract_aac: the opaque account-access context from process_client_data. */
export function extractAac(result: unknown): string {
  const data = bloksPayload(result)?.data;
  if (!Array.isArray(data)) return "";
  for (const node of data) {
    const payload = isObject(node) ? node.data : undefined;
    if (!isObject(payload) || payload.key !== "CAA_ACCOUNT_ACCESS_CONTEXT:aac") continue;
    if (typeof payload.initial === "string" && payload.initial.trim()) return payload.initial;
    if (typeof payload.initial_lispy === "string" && payload.initial_lispy) {
      const quote = payload.initial_lispy.indexOf('"');
      const decoded = quote < 0 ? null : decodeJsonString(payload.initial_lispy, quote);
      if (decoded && typeof decoded.value === "string" && decoded.value) return decoded.value;
    }
  }
  return "";
}

const COOKIE_RESERVED = new Set([
  "expires", "path", "comment", "domain", "max-age", "secure", "httponly", "version", "samesite", "partitioned",
]);

/** Python SimpleCookie().load(raw.replace("Set-Cookie: ", "")) reduced to name -> value. */
export function parseCookieBlob(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of raw.replaceAll("Set-Cookie: ", "").split(/[;\r\n]+/)) {
    const trimmed = token.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    if (COOKIE_RESERVED.has(name.toLowerCase())) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[name] = value;
  }
  return out;
}

export interface LoginPayload {
  loginResponse: Json;
  /** Response headers of the embedded login response (e.g. IG-Set-Authorization). */
  headers: Record<string, string>;
  cookies: Record<string, string>;
}

/**
 * bloks.py bloks_extract_login_response: the {login_response, headers,
 * cookies} object embedded as a JSON string literal in the bloks action.
 */
export function extractLoginResponse(result: unknown): LoginPayload | null {
  const action = bloksAction(result);
  if (action === undefined || action.length > MAX_SCAN_LENGTH) return null;
  let index = 0;
  while (index < action.length) {
    if (action[index] !== '"') {
      index++;
      continue;
    }
    const decoded = decodeJsonString(action, index);
    if (!decoded) break; // No closing quote: nothing after this can be a literal.
    index = decoded.end;
    const value = decoded.value;
    if (typeof value !== "string" || !value.includes("login_response")) continue;
    try {
      const raw: unknown = JSON.parse(value);
      if (!isObject(raw) || typeof raw.login_response !== "string") continue;
      const loginResponse: unknown = JSON.parse(raw.login_response);
      const headers: unknown = JSON.parse(typeof raw.headers === "string" && raw.headers ? raw.headers : "{}");
      const headerMap: Record<string, string> = {};
      if (isObject(headers)) {
        for (const [name, headerValue] of Object.entries(headers)) {
          if (typeof headerValue === "string") headerMap[name] = headerValue;
        }
      }
      return {
        loginResponse: isObject(loginResponse) ? loginResponse : {},
        headers: headerMap,
        cookies: parseCookieBlob(typeof raw.cookies === "string" ? raw.cookies : ""),
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** auth.py _infer_bloks_two_factor_challenge: SMS only when SMS is on and TOTP is off. */
export function inferTwoFactorMethod(data: unknown): "sms" | "totp" {
  const flag = (key: string): boolean => {
    const value = findLoginResponseValue(data, key);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return ["1", "true", "yes"].includes(value.trim().toLowerCase());
    return false;
  };
  return flag("sms_two_factor_on") && !flag("totp_two_factor_on") ? "sms" : "totp";
}

const ERROR_DIALOG_LABELS = ["incorrect password", "can't find account", "can’t find account"];

/** Non-secret hints about a CAA response, for error messages. */
export function bloksHints(result: unknown): {
  fallback: boolean;
  fallbackMarkers: string[];
  errorLabels: string[];
  emailChallenge: boolean;
  approveFromAnotherDevice: boolean;
} {
  const strings = collectStrings(result);
  const joined = strings.join("\n");
  const lower = joined.toLowerCase();
  const fallbackMarkers = [...new Set(strings.filter((s) => s.startsWith("CAA_LOGIN_FALLBACK:")).map((s) => s.slice(0, 120)))];
  return {
    fallback: fallbackMarkers.length > 0,
    fallbackMarkers: fallbackMarkers.slice(0, 4),
    errorLabels: ERROR_DIALOG_LABELS.filter(
      (label) =>
        strings.some((s) => s.toLowerCase() === label) ||
        lower.includes(JSON.stringify(label)) ||
        lower.includes(pyDumps(label))
    ),
    emailChallenge: joined.includes("email_challenge"),
    approveFromAnotherDevice: joined.includes("APPROVE_FROM_ANOTHER_DEVICE"),
  };
}
