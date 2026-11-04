/**
 * Password encryption for login requests (`enc_password`).
 *
 * Format `#PWD_INSTAGRAM:4:<unix time>:<base64 payload>`, where the payload is
 * 0x01 | key id | 12-byte IV | RSA length (2 bytes LE) | RSA-PKCS#1 v1.5 of a
 * random AES-256 key | GCM tag | AES-256-GCM ciphertext, with the timestamp as
 * additional authenticated data. Ported from instagrapi (MIT, see NOTICE).
 */

import { constants, createCipheriv, publicEncrypt, randomBytes } from "node:crypto";

export interface PasswordEncryptionKey {
  /** From the `ig-set-password-encryption-key-id` response header. */
  keyId: number;
  /** Base64 PEM, from the `ig-set-password-encryption-pub-key` response header. */
  publicKey: string;
}

export function encryptPassword(
  password: string,
  key: PasswordEncryptionKey,
  now: number = Date.now()
): string {
  const timestamp = String(Math.floor(now / 1000));
  const sessionKey = randomBytes(32);
  const iv = randomBytes(12);
  const pem = Buffer.from(key.publicKey, "base64").toString("utf8");
  const rsaEncrypted = publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, sessionKey);

  const cipher = createCipheriv("aes-256-gcm", sessionKey, iv);
  cipher.setAAD(Buffer.from(timestamp, "utf8"));
  const aesEncrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const size = Buffer.alloc(2);
  size.writeUInt16LE(rsaEncrypted.length);
  const payload = Buffer.concat([
    Buffer.from([1, key.keyId & 0xff]),
    iv,
    size,
    rsaEncrypted,
    tag,
    aesEncrypted,
  ]).toString("base64");
  return `#PWD_INSTAGRAM:4:${timestamp}:${payload}`;
}
