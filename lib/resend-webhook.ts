import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs webhooks the Svix way: the secret is "whsec_" + base64 key;
// the signed content is "<svix-id>.<svix-timestamp>.<raw body>"; the
// signature header lists space-separated "v1,<base64 hmac-sha256>" values
// (several during a secret rotation) and the request is good when any one
// matches. Timestamps outside the tolerance are replays or clock drift.
// Pure (the clock is a parameter) so it can be tested with a fixed vector.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SvixHeaders = {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
};

export function svixHeadersFrom(headers: Headers): SvixHeaders {
  return {
    id: headers.get("svix-id"),
    timestamp: headers.get("svix-timestamp"),
    signature: headers.get("svix-signature"),
  };
}

export function signSvix(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isInteger(ts)) return false;
  if (Math.abs(nowSeconds - ts) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(signSvix(secret, headers.id, headers.timestamp, rawBody));
  for (const entry of headers.signature.split(/\s+/)) {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}
