import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tokenAal } from "./admin/mfa.ts";
import { ADMIN_EMAIL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase.ts";

// Who may call the admin and job routes. One place decides, so a route
// can't forget half the rule:
//   - the owner, signed in AND past the second step: the Supabase access
//     token must belong to the admin email and carry `aal2`, the mark a
//     session gets once an authenticator code has been accepted. A
//     password or magic link alone (`aal1`) is refused.
//   - for job routes only, Vercel cron: `Authorization: Bearer $CRON_SECRET`.

// The email the auth server ties to a token, or null when it rejects the
// token (forged, expired, signed out). Swappable so tests need no network.
export type EmailLookup = (token: string) => Promise<string | null>;

function clientFor(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

const supabaseEmail: EmailLookup = async (token) => {
  const { data } = await clientFor(token).auth.getUser(token);
  return data.user?.email ?? null;
};

export function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

// The request's token when it is the owner's and has passed the second
// step, else null. The level is read from the token itself, which is only
// believed because the auth server then vouches for that same token.
export async function adminToken(
  req: Request,
  lookup: EmailLookup = supabaseEmail
): Promise<string | null> {
  const token = bearerToken(req);
  if (!token || tokenAal(token) !== "aal2") return null;
  return (await lookup(token)) === ADMIN_EMAIL ? token : null;
}

// For the admin's own routes: a Supabase client acting as the owner (row
// level security still applies to everything it does), or null to answer
// 401.
export async function requireAdmin(
  req: Request,
  lookup: EmailLookup = supabaseEmail
): Promise<SupabaseClient | null> {
  const token = await adminToken(req, lookup);
  return token ? clientFor(token) : null;
}

// Whether two secrets are the same, taking the same time whether they
// differ at the first character or the last, so response times can't be
// used to guess the cron secret a character at a time. Both sides are
// hashed first: `timingSafeEqual` needs equal lengths, and this way the
// secret's length doesn't show either.
export function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Auth for the job routes: Vercel cron sends `Authorization: Bearer
// $CRON_SECRET`; an admin page sends the owner's Supabase access token.
export async function authorizeJob(
  req: Request,
  lookup: EmailLookup = supabaseEmail
): Promise<boolean> {
  const token = bearerToken(req);
  if (!token) return false;
  const secret = process.env.CRON_SECRET;
  if (secret && sameSecret(token, secret)) return true;
  return (await adminToken(req, lookup)) !== null;
}
