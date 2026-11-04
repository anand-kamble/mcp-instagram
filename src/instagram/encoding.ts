/**
 * Body encodings matching instagrapi (Python) byte for byte.
 */

/**
 * Python's `json.dumps(value, separators=(",", ":"))`: compact, with every
 * non-ASCII character escaped as \uXXXX (surrogate pairs for astral planes).
 */
export function pyDumps(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Python's urllib.parse.quote_plus: UTF-8, spaces as "+", only A-Z a-z 0-9 _ . - ~ unescaped. */
export function quotePlus(text: string): string {
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** requests-style form encoding of a flat object; non-string values are JSON-encoded. */
export function formEncode(form: Record<string, unknown>): string {
  return Object.entries(form)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${quotePlus(key)}=${quotePlus(typeof value === "string" ? value : pyDumps(value))}`)
    .join("&");
}

/** instagrapi generate_signature: `signed_body=SIGNATURE.<quote_plus(compact json)>`. */
export function signedBody(form: Record<string, unknown>): string {
  return `signed_body=SIGNATURE.${quotePlus(pyDumps(form))}`;
}
