/**
 * HTTP transports for InstagramClient.
 *
 * The default speaks HTTP/2 only (ALPN h2) over TLS 1.3 with the curve list
 * instagrapi's curl transport uses, via Node's built-in http2 module. This is
 * the setup a live CAA login from Node was verified with. Certificate
 * verification stays on. Ported from the CAA probe (see NOTICE).
 */

import { connect, constants as h2constants } from "node:http2";
import type { ClientHttp2Session } from "node:http2";
import { createSecureContext } from "node:tls";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export interface TransportRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Lower-cased header names; repeated headers joined with ", " (except Set-Cookie). */
  headers: Record<string, string>;
  setCookie: string[];
  body: string;
}

export interface Transport {
  (request: TransportRequest): Promise<TransportResponse>;
  close?: () => Promise<void> | void;
}

const PREFERRED_CURVES = "X25519MLKEM768:X25519:P-256:P-384";

/** The hybrid post-quantum group needs OpenSSL 3.5 (Node 24); older builds fall back. */
const ECDH_CURVES = (() => {
  try {
    createSecureContext({ ecdhCurve: PREFERRED_CURVES });
    return PREFERRED_CURVES;
  } catch {
    return "X25519:P-256:P-384";
  }
})();

const H2_FORBIDDEN = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

function decode(buffer: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
      return gunzipSync(buffer);
    case "deflate":
      return inflateSync(buffer);
    case "br":
      return brotliDecompressSync(buffer);
    default:
      return buffer;
  }
}

/** HTTP/2-only transport with pooled sessions per origin. `ca` adds a trusted root (tests only). */
export function createH2Transport(options: { ca?: string | Buffer } = {}): Transport {
  const sessions = new Map<string, ClientHttp2Session>();
  const session = (origin: string): ClientHttp2Session => {
    const existing = sessions.get(origin);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const created = connect(origin, {
      ALPNProtocols: ["h2"],
      minVersion: "TLSv1.3",
      ecdhCurve: ECDH_CURVES,
      ...(options.ca ? { ca: options.ca } : {}),
    });
    created.on("error", () => sessions.delete(origin));
    created.on("close", () => sessions.delete(origin));
    created.setTimeout(60_000, () => created.close());
    created.unref();
    sessions.set(origin, created);
    return created;
  };

  const transport: Transport = (req) =>
    new Promise<TransportResponse>((resolve, reject) => {
      const url = new URL(req.url);
      const headers: Record<string, string> = {
        [h2constants.HTTP2_HEADER_METHOD]: req.method,
        [h2constants.HTTP2_HEADER_PATH]: url.pathname + url.search,
        [h2constants.HTTP2_HEADER_SCHEME]: "https",
        [h2constants.HTTP2_HEADER_AUTHORITY]: url.host,
      };
      for (const [name, value] of Object.entries(req.headers)) {
        const lower = name.toLowerCase();
        if (H2_FORBIDDEN.has(lower) || value === "") continue;
        headers[lower] = value;
      }
      if (req.body !== undefined) headers["content-length"] = String(Buffer.byteLength(req.body));

      let stream;
      try {
        const s = session(url.origin);
        s.ref();
        stream = s.request(headers, { endStream: req.body === undefined, signal: req.signal });
        stream.on("close", () => s.unref());
      } catch (error) {
        reject(error);
        return;
      }
      let status = 0;
      let responseHeaders: Record<string, string | string[] | undefined> = {};
      const chunks: Buffer[] = [];
      stream.on("response", (h) => {
        status = Number(h[h2constants.HTTP2_HEADER_STATUS]);
        responseHeaders = h as Record<string, string | string[] | undefined>;
      });
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => {
        try {
          const raw = Buffer.concat(chunks);
          const encoding = responseHeaders["content-encoding"];
          const body = decode(raw, Array.isArray(encoding) ? encoding[0] : encoding).toString("utf8");
          const out: Record<string, string> = {};
          for (const [name, value] of Object.entries(responseHeaders)) {
            if (name.startsWith(":") || value === undefined || name === "set-cookie") continue;
            out[name] = Array.isArray(value) ? value.join(", ") : String(value);
          }
          const setCookie = responseHeaders["set-cookie"];
          resolve({
            status,
            headers: out,
            setCookie: setCookie === undefined ? [] : ([] as string[]).concat(setCookie),
            body,
          });
        } catch (error) {
          reject(error);
        }
      });
      if (req.body !== undefined) stream.end(req.body);
    });

  transport.close = () => {
    for (const s of sessions.values()) s.close();
    sessions.clear();
  };
  return transport;
}

/** Adapts a fetch implementation (tests, or HTTP/1.1 fallback) to the Transport contract. */
export function fetchTransport(fetchImpl: typeof fetch): Transport {
  return async (req) => {
    const response = await fetchImpl(req.url, {
      method: req.method,
      headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => v !== "")),
      body: req.body,
      signal: req.signal,
      redirect: "manual",
    });
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") headers[name] = value;
    });
    return { status: response.status, headers, setCookie: response.headers.getSetCookie?.() ?? [], body };
  };
}
