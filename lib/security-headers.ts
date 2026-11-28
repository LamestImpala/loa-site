// Security response headers, shared by next.config.ts (every route) and
// proxy.ts (the pages that get a per-request nonce). Keep this module
// dependency-free: next.config.ts loads it before the app is built.

/**
 * false: the full policy goes out as Content-Security-Policy-Report-Only.
 * Browsers log what it would block and block nothing. Only the frame rule
 * is enforced, in a one-directive Content-Security-Policy of its own
 * (browsers ignore frame-ancestors in a report-only policy).
 *
 * true: the full policy is enforced. Flip this after a week with no
 * reports; nothing else changes.
 */
export const CSP_ENFORCED = false;

export type Header = { key: string; value: string };

// The shop's database, photo storage and sign-in. The same host that
// next.config.ts allows for photos and lib/supabase.ts connects to.
const SUPABASE = "https://spmbjuurarlpyqcqxyyz.supabase.co";

/** Sent on every response: pages, API routes and static files. */
export const BASE_HEADERS: Header[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No page of the site is ever shown inside a frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * Pages that carry a signed-in session and show text other people typed
 * (order notes, emails, player names). They get a per-request nonce from
 * proxy.ts, so an injected inline script does not run. Every other page
 * is prerendered and cached, which a nonce would switch off, so it keeps
 * 'unsafe-inline' for scripts.
 */
const NONCE_SECTIONS = ["admin", "pickem"];

export function needsNonce(pathname: string): boolean {
  return NONCE_SECTIONS.some((s) => pathname === `/${s}` || pathname.startsWith(`/${s}/`));
}

/**
 * next.config.ts `source` for every path except the nonce pages, which
 * proxy.ts covers. Also a valid regular expression, which the tests use
 * to check it against needsNonce().
 */
export const STATIC_CSP_SOURCE = `/((?!${NONCE_SECTIONS.map((s) => `${s}$|${s}/`).join("|")}).*)`;

type PolicyOptions = {
  /** Per-request nonce; omit for the prerendered pages. */
  nonce?: string;
  /** next dev: React needs eval, and Vercel's analytics load a debug script from its CDN. */
  dev?: boolean;
};

export function contentSecurityPolicy({ nonce, dev = false }: PolicyOptions = {}): string {
  const script = nonce
    ? // 'strict-dynamic' lets the nonced Next.js runtime load its own
      // chunks; browsers that understand it ignore 'self' here.
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
    : ["'self'", "'unsafe-inline'"];
  if (dev) script.push("'unsafe-eval'", "https://va.vercel-scripts.com");

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    // React writes style="" attributes into the HTML; those need 'unsafe-inline'.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Discogs covers, record photos (Supabase storage), pick'em team
    // logos; blob: for photo previews before upload and the 3D crate's
    // textures; data: for the two-step sign-in QR code.
    ["img-src", ["'self'", "data:", "blob:", "https://i.discogs.com", SUPABASE, "https://a.espncdn.com"]],
    ["font-src", ["'self'", "data:"]],
    // Every browser request goes to the site's own /api routes or to Supabase.
    ["connect-src", ["'self'", SUPABASE]],
    // The label reader's pdf.js worker is bundled with the site.
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** The policy as response headers, under the name the current phase uses. */
export function cspHeaders(options: PolicyOptions = {}): Header[] {
  return [
    {
      key: CSP_ENFORCED ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
      value: contentSecurityPolicy(options),
    },
  ];
}

/**
 * While the full policy is report-only, this enforces the one rule that
 * cannot wait: no other site may frame these pages. Empty once the full
 * policy is enforced, since that carries the same rule.
 */
export function frameGuardHeaders(): Header[] {
  return CSP_ENFORCED ? [] : [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }];
}

/** A fresh nonce for one response. */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}
