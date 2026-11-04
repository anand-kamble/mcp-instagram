/**
 * USDID device key (the Android app's per-install identity used by the CAA
 * login): a P-256 key registered with Instagram, then sent as a short-lived
 * signed `X-Meta-Usdid` header. Ported from instagrapi attestation.py via the
 * CAA probe (MIT, see NOTICE). Signatures are DER-encoded, as instagrapi does.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { APP_ID } from "./device.js";
import { pyDumps } from "./encoding.js";

export const USDID_TOKEN_TTL_SECONDS = 3600;
const REFRESH_MARGIN_SECONDS = 300;

export interface UsdidState {
  usdid: string;
  kid: string;
  /** PKCS#8 PEM of the P-256 private key. */
  privateKeyPem: string;
  registered: boolean;
}

const b64u = (data: Buffer | string): string => Buffer.from(data).toString("base64url");

export function createUsdid(): UsdidState {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    usdid: randomUUID(),
    kid: b64u(randomBytes(32)),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    registered: false,
  };
}

function signDer(state: UsdidState, message: string): Buffer {
  return sign("sha256", Buffer.from(message), { key: createPrivateKey(state.privateKeyPem), dsaEncoding: "der" });
}

/** Builds the `X-Meta-Usdid` value, caching it until shortly before it expires. */
export class UsdidHeader {
  private cached = "";
  private expiresAt = 0;

  constructor(private readonly state: UsdidState) {}

  value(nowSeconds: number = Math.floor(Date.now() / 1000)): string {
    if (this.cached && this.expiresAt - nowSeconds > REFRESH_MARGIN_SECONDS) return this.cached;
    this.expiresAt = nowSeconds + USDID_TOKEN_TTL_SECONDS;
    const signed = `${this.state.usdid}.${this.expiresAt}`;
    this.cached = `${signed}.${b64u(signDer(this.state, signed))}`;
    return this.cached;
  }
}

/** The JWS-like token sent in IGUSDIDRegistrationMutation. */
export function usdidRegistrationToken(state: UsdidState, nowSeconds: number = Math.floor(Date.now() / 1000)): string {
  const pub = createPublicKey(createPrivateKey(state.privateKeyPem)).export({ type: "spki", format: "der" });
  const payload = b64u(
    pyDumps({
      sub: state.usdid,
      iat: nowSeconds,
      aud: APP_ID,
      exp: nowSeconds + USDID_TOKEN_TTL_SECONDS,
      pub: pub.toString("base64"),
      alg: "ES256",
    })
  );
  const protectedPart = b64u(pyDumps({ typ: "JWT", alg: "ES256", kid: state.kid, aid: APP_ID, ver: "1" }));
  const token = {
    payload,
    signatures: [{ protected: protectedPart, signature: b64u(signDer(state, `${protectedPart}.${payload}`)) }],
  };
  return b64u(pyDumps(token));
}
