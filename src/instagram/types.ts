/**
 * Public types of the Instagram private-API client.
 */

/** One request to https://i.instagram.com/api/v1/<path>. */
export interface IgRequest {
  /** Defaults to POST when `form` is given, otherwise GET. */
  method?: "GET" | "POST";
  /** Path relative to /api/v1/, e.g. "users/25025320/info/". A leading "/" makes it absolute (e.g. "/graphql_www"). */
  path: string;
  /** Query string parameters; undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * POST body. Signed requests (the default) send
   * `signed_body=SIGNATURE.<JSON of form>`; unsigned ones send the fields
   * URL-encoded, with non-string values JSON-encoded.
   */
  form?: Record<string, unknown>;
  /** Wrap `form` in signed_body. Default true. */
  signed?: boolean;
  /** Extra headers for this request only (e.g. X-FB-Friendly-Name). */
  headers?: Record<string, string>;
  /** Host to call; defaults to i.instagram.com. The CAA login uses b.i.instagram.com. */
  domain?: string;
  /** Accept an NDJSON body and use its first JSON line (GraphQL). */
  ndjson?: boolean;
}

/** Emulated Android device. Persisted with the session so it stays stable. */
export interface DeviceProfile {
  appVersion: string;
  versionCode: string;
  bloksVersionId: string;
  androidVersion: number;
  androidRelease: string;
  dpi: string;
  resolution: string;
  manufacturer: string;
  model: string;
  device: string;
  cpu: string;
  locale: string;
  /** X-IG-Device-ID / `_uuid` / `qe_device_id` (UUID v4). */
  uuid: string;
  /** X-IG-Family-Device-ID / `phone_id` (UUID v4). */
  phoneId: string;
  /** X-IG-Android-ID / `device_id` ("android-" + 16 hex). */
  androidId: string;
  /** Advertising id (UUID v4). */
  adid: string;
  /** Seconds east of UTC, sent as X-IG-Timezone-Offset. */
  timezoneOffset: number;
}

/** Contents of the `Authorization: Bearer IGT:2:<base64 JSON>` header. */
export interface AuthorizationData {
  ds_user_id: string;
  sessionid: string;
  should_use_header_over_cookies?: boolean;
  [key: string]: unknown;
}

/** Everything needed to resume a session; serialized to session.json. */
export interface SessionState {
  /** Format version of this object. */
  version: 2;
  device: DeviceProfile;
  /** Cookies for .instagram.com, name -> value. */
  cookies: Record<string, string>;
  authorization?: AuthorizationData;
  /** X-MID (from ig-set-x-mid). */
  mid?: string;
  /** IG-U-RUR (from ig-set-ig-u-rur). */
  rur?: string;
  /** X-IG-WWW-Claim (from x-ig-set-www-claim). */
  wwwClaim?: string;
  /** SHA-256 (hex) of the IG_SESSION_ID value this session was imported from, if any. */
  importedSessionIdSha256?: string;
  /** USDID device key used by the CAA login. */
  usdid?: { usdid: string; kid: string; privateKeyPem: string; registered: boolean };
  /** Logged-in user. */
  userId?: string;
  username?: string;
}
