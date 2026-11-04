/**
 * Transport, body encoding and USDID key tests (local only, no Instagram).
 */

import { execFileSync } from "node:child_process";
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createSecureServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createH2Transport,
  createUsdid,
  formEncode,
  pyDumps,
  quotePlus,
  signedBody,
  UsdidHeader,
  usdidRegistrationToken,
} from "../instagram/index.js";

describe("Python-compatible encoding", () => {
  // Expected values produced by Python's json.dumps(separators=(",", ":")) and urllib.parse.quote_plus.
  it.each([
    ["é😀\u007f  x", '{"s":"\\u00e9\\ud83d\\ude00\\u007f\\u2028 x"}', "%C3%A9%F0%9F%98%80%7F%E2%80%A8+x"],
    ["a b&c=d/e?f~g*h!i'j(k)l", '{"s":"a b&c=d/e?f~g*h!i\'j(k)l"}', "a+b%26c%3Dd%2Fe%3Ff~g%2Ah%21i%27j%28k%29l"],
    ["\u0001\n\t\"\\", '{"s":"\\u0001\\n\\t\\"\\\\"}', "%01%0A%09%22%5C"],
  ])("encodes %j like Python", (input, dumped, quoted) => {
    expect(pyDumps({ s: input })).toBe(dumped);
    expect(quotePlus(input)).toBe(quoted);
  });

  it("builds signed and plain form bodies", () => {
    expect(signedBody({ a: "x y", n: 1 })).toBe("signed_body=SIGNATURE.%7B%22a%22%3A%22x+y%22%2C%22n%22%3A1%7D");
    expect(formEncode({ a: "x y", b: { c: true }, d: undefined })).toBe("a=x+y&b=%7B%22c%22%3Atrue%7D");
  });
});

describe("USDID", () => {
  const b64uJson = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

  it("signs X-Meta-Usdid headers with the device key and caches them", () => {
    const state = createUsdid();
    const header = new UsdidHeader(state);
    const value = header.value(1_000_000);
    const [usdid, exp, signature] = value.split(".");
    expect(usdid).toBe(state.usdid);
    expect(Number(exp)).toBe(1_000_000 + 3600);
    const ok = verify("sha256", Buffer.from(`${usdid}.${exp}`), createPublicKey(state.privateKeyPem), Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
    expect(header.value(1_000_000 + 3000)).toBe(value);
    expect(header.value(1_000_000 + 3400)).not.toBe(value);
  });

  it("builds a registration token whose signature verifies", () => {
    const state = createUsdid();
    const token = b64uJson(usdidRegistrationToken(state, 1_700_000_000));
    const payload = b64uJson(token.payload);
    expect(payload).toMatchObject({ sub: state.usdid, iat: 1_700_000_000, exp: 1_700_003_600, aud: "567067343352427", alg: "ES256" });
    expect(createPublicKey({ key: Buffer.from(payload.pub, "base64"), format: "der", type: "spki" }).asymmetricKeyType).toBe("ec");
    const { protected: protectedPart, signature } = token.signatures[0];
    expect(b64uJson(protectedPart)).toEqual({ typ: "JWT", alg: "ES256", kid: state.kid, aid: "567067343352427", ver: "1" });
    const ok = verify(
      "sha256",
      Buffer.from(`${protectedPart}.${token.payload}`),
      createPublicKey(state.privateKeyPem),
      Buffer.from(signature, "base64url")
    );
    expect(ok).toBe(true);
  });
});

/** A self-signed certificate for localhost, or undefined when no usable openssl is installed. */
function selfSignedCert(): { dir: string; key: Buffer; cert: Buffer } | undefined {
  const dir = mkdtempSync(join(tmpdir(), "mcp-instagram-tls-"));
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"),
        "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"],
      { stdio: "ignore" }
    );
    return { dir, key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
}

const tls = selfSignedCert();
(tls ? describe : describe.skip)("HTTP/2 transport", () => {
  let server: ReturnType<typeof createSecureServer>;
  let origin: string;
  const seen: Array<{ method?: string; path?: string; body: string; headers: Record<string, unknown> }> = [];

  beforeAll(async () => {
    server = createSecureServer({ key: tls!.key, cert: tls!.cert, minVersion: "TLSv1.3" }, (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push({ method: req.method, path: req.url, body, headers: { ...req.headers } });
        res.setHeader("content-encoding", "gzip");
        res.setHeader("set-cookie", ["a=1; Path=/", "b=2; Path=/"]);
        res.setHeader("ig-set-x-mid", "MID");
        res.end(gzipSync(JSON.stringify({ status: "ok", alpn: (req.socket as { alpnProtocol?: string }).alpnProtocol })));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `https://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tls!.dir, { recursive: true, force: true });
  });

  it("speaks h2 over TLS 1.3, decodes gzip and returns every Set-Cookie", async () => {
    const transport = createH2Transport({ ca: tls!.cert });
    try {
      const response = await transport({
        method: "POST",
        url: `${origin}/api/v1/x/?q=1`,
        headers: { "User-Agent": "test", "X-Empty": "", Connection: "keep-alive" },
        body: "a=1",
        signal: AbortSignal.timeout(5000),
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ status: "ok", alpn: "h2" });
      expect(response.setCookie).toEqual(["a=1; Path=/", "b=2; Path=/"]);
      expect(response.headers["ig-set-x-mid"]).toBe("MID");
      const last = seen[seen.length - 1];
      expect(last).toMatchObject({ method: "POST", path: "/api/v1/x/?q=1", body: "a=1" });
      expect(last.headers["user-agent"]).toBe("test");
      expect(last.headers["x-empty"]).toBeUndefined();
    } finally {
      await transport.close?.();
    }
  });

  it("keeps certificate verification on", async () => {
    const transport = createH2Transport();
    try {
      await expect(
        transport({ method: "GET", url: `${origin}/`, headers: {}, signal: AbortSignal.timeout(5000) })
      ).rejects.toThrow(/self[- ]signed|certificate/i);
    } finally {
      await transport.close?.();
    }
  });
});
