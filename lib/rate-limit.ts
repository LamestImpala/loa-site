import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Per-visitor limits for the public write endpoints. A visitor is their IP
// address, stored only as a keyed hash: the route counts that hash's recent
// rows in the table it is about to write to, so there is no counter table
// to keep clean. Server-only (it needs the hashing secret).

// The caller's address as Vercel reports it. Vercel sets x-real-ip on every
// request and overwrites whatever the client sent, so it can't be forged
// there. Local dev has no such header: every request is then one shared
// visitor, which still limits and makes the limit easy to see.
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

// What one visitor's address collapses to. IPv4 stays whole. An IPv6
// customer is handed a whole /64 and can pick a fresh address in it per
// request, so only the network half counts. IPv4-mapped IPv6
// (::ffff:1.2.3.4) is the IPv4 address.
export function ipBucket(ip: string): string {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!addr.includes(":")) return addr;
  const mapped = addr.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = addr.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":");
}

// The stored form of a visitor: an HMAC of their address bucket, so the
// table never holds an IP and the hash can't be reversed or recomputed
// without the server's secret.
export function visitorHash(ip: string | null, secret: string): string {
  return createHmac("sha256", secret)
    .update(`visitor:v1:${ip ? ipBucket(ip) : "unknown"}`)
    .digest("hex")
    .slice(0, 32);
}

// The hashing secret is the service-role key the same routes already need:
// one less value to set, and it never leaves the server. Rotating it only
// forgets the current hour's counts.
export function visitorSecret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return key;
}

export type RateWindow = {
  table: string;
  column: string;
  value: string;
  windowMs: number;
  max: number;
};

// True when `value` already has `max` rows in the window. A failed count
// reads as "under the limit": a limit must never be the reason a real
// buyer is turned away, and each table keeps its own shop-wide cap in the
// database as the backstop.
export async function overLimit(
  db: SupabaseClient,
  w: RateWindow,
  now: number = Date.now()
): Promise<boolean> {
  const since = new Date(now - w.windowMs).toISOString();
  const { count, error } = await db
    .from(w.table)
    .select("id", { count: "exact", head: true })
    .eq(w.column, w.value)
    .gte("created_at", since);
  if (error) {
    console.error(`rate limit: ${w.table}.${w.column} count failed:`, error.message);
    return false;
  }
  return (count ?? 0) >= w.max;
}
