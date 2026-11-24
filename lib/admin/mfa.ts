// Two-step sign-in for the admin: the pure pieces the sign-in gate, the
// Settings section and the server check share. Supabase calls a second
// factor "MFA" and marks a session that has passed one `aal2` (password or
// magic link alone is `aal1`); the level is a claim inside the access token.

// The one field of a Supabase factor these helpers read; the full type is
// `Factor` in @supabase/supabase-js.
export type FactorLike = {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string | null;
};

// The assurance level written in an access token, or null when the token
// isn't a readable JWT. This only reads the claim: the caller must already
// trust the token (the browser's own session, or a token the auth server
// has just accepted).
export function tokenAal(accessToken: string | null | undefined): string | null {
  const part = accessToken?.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const aal =
      payload && typeof payload === "object" ? (payload as { aal?: unknown }).aal : null;
    return typeof aal === "string" ? aal : null;
  } catch {
    return null;
  }
}

// The authenticator apps that can answer a code prompt. A factor that was
// started but never confirmed with a first code ("unverified") protects
// nothing and is never asked for.
export function verifiedTotp<F extends FactorLike>(factors: readonly F[] | null | undefined): F[] {
  return (factors ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified");
}

// What stands between a signed-in admin and the admin pages:
//   "ok"        — the session has passed a code, or no authenticator is set
//                 up yet (two-step sign-in is off);
//   "challenge" — an authenticator is set up and this session hasn't
//                 answered it: ask for a code first.
export type TwoStep = "ok" | "challenge";

export function twoStepFor(aal: string | null, factors: readonly FactorLike[] | null | undefined): TwoStep {
  if (aal === "aal2") return "ok";
  return verifiedTotp(factors).length > 0 ? "challenge" : "ok";
}

// Six digits, whatever was typed or pasted around them ("123 456").
export function cleanCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

// A name for a new authenticator that none of the account's factors has:
// Supabase refuses two factors with the same name, counting unconfirmed
// leftovers.
export function nextFactorName(factors: readonly FactorLike[] | null | undefined, base = "Authenticator app"): string {
  const taken = new Set((factors ?? []).map((f) => (f.friendly_name ?? "").trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

// The setup key in groups of four, easier to type into an app by hand.
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}
