// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_HEADERS,
  CSP_ENFORCED,
  STATIC_CSP_SOURCE,
  configHeaderRules,
  contentSecurityPolicy,
  cspHeaders,
  frameGuardHeaders,
  needsNonce,
  newNonce,
  staticPolicyHeaders,
} from "./security-headers.ts";

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((d) => d.startsWith(`${name} `));
  assert.ok(found, `${name} is in the policy`);
  return found.split(" ").slice(1);
}

test("base headers: sniffing, referrer, framing and device permissions", () => {
  const byKey = Object.fromEntries(BASE_HEADERS.map((h) => [h.key, h.value]));
  assert.equal(byKey["X-Content-Type-Options"], "nosniff");
  assert.equal(byKey["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(byKey["X-Frame-Options"], "DENY");
  assert.equal(byKey["Permissions-Policy"], "camera=(), microphone=(), geolocation=()");
});

test("nonce pages: the admin and pick'em, and nothing that only starts the same", () => {
  for (const p of ["/admin", "/admin/", "/admin/ship/orders", "/pickem", "/pickem/x"]) {
    assert.equal(needsNonce(p), true, p);
  }
  for (const p of ["/", "/administer", "/pickems", "/records/admin", "/r/admin", "/api/pickem/nfl/live"]) {
    assert.equal(needsNonce(p), false, p);
  }
});

test("the next.config source covers exactly the paths the proxy does not", () => {
  const source = new RegExp(`^${STATIC_CSP_SOURCE}$`);
  const paths = [
    "/", "/admin", "/admin/", "/admin/catalog", "/administer", "/pickem", "/pickem/nfl", "/pickems",
    "/r/some-record", "/records/admin", "/api/track", "/_next/static/chunks/a.js", "/reviews",
  ];
  for (const p of paths) assert.equal(source.test(p), !needsNonce(p), p);
});

test("static policy: own scripts and inline ones, no eval, nothing from other sites", () => {
  const policy = contentSecurityPolicy();
  assert.deepEqual(directive(policy, "default-src"), ["'self'"]);
  assert.deepEqual(directive(policy, "script-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(directive(policy, "object-src"), ["'none'"]);
  assert.deepEqual(directive(policy, "base-uri"), ["'self'"]);
  assert.deepEqual(directive(policy, "form-action"), ["'self'"]);
  assert.deepEqual(directive(policy, "frame-ancestors"), ["'none'"]);
  assert.ok(!policy.includes("unsafe-eval"));
  assert.ok(!policy.includes("nonce-"));
  assert.ok(!policy.includes("*"), "no wildcard sources");
  assert.ok(!policy.includes("\n"));
});

test("static policy: the outside hosts the pages load from", () => {
  const policy = contentSecurityPolicy();
  const supabase = "https://spmbjuurarlpyqcqxyyz.supabase.co";
  assert.deepEqual(directive(policy, "connect-src"), ["'self'", supabase]);
  const img = directive(policy, "img-src");
  for (const src of ["'self'", "data:", "blob:", "https://i.discogs.com", supabase, "https://a.espncdn.com"]) {
    assert.ok(img.includes(src), src);
  }
  assert.deepEqual(directive(policy, "worker-src"), ["'self'", "blob:"]);
});

test("nonce policy: inline scripts need the nonce", () => {
  const policy = contentSecurityPolicy({ nonce: "abc123==" });
  const script = directive(policy, "script-src");
  assert.deepEqual(script, ["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  assert.ok(!script.includes("'unsafe-inline'"));
  // Styles keep 'unsafe-inline'; a nonce there would switch it off.
  assert.deepEqual(directive(policy, "style-src"), ["'self'", "'unsafe-inline'"]);
});

test("dev only: eval and the analytics debug script", () => {
  for (const nonce of [undefined, "abc123=="]) {
    const script = directive(contentSecurityPolicy({ nonce, dev: true }), "script-src");
    assert.ok(script.includes("'unsafe-eval'"));
    assert.ok(script.includes("https://va.vercel-scripts.com"));
  }
});

test("a nonce Next.js will accept, different every time", () => {
  // The pattern Next.js uses to pull the nonce out of the policy.
  const accepted = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;
  const a = newNonce();
  const b = newNonce();
  assert.notEqual(a, b);
  assert.match(`'nonce-${a}'`, accepted);
  assert.ok(a.length >= 24);
});

test("phase: report-only sends the full policy unenforced plus an enforced frame rule", () => {
  const [full, ...rest] = cspHeaders({ nonce: "abc123==" });
  assert.equal(rest.length, 0);
  assert.equal(full.value, contentSecurityPolicy({ nonce: "abc123==" }));
  if (CSP_ENFORCED) {
    assert.equal(full.key, "Content-Security-Policy");
    assert.deepEqual(frameGuardHeaders(), []);
  } else {
    assert.equal(full.key, "Content-Security-Policy-Report-Only");
    assert.deepEqual(frameGuardHeaders(), [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ]);
  }
});

test("config rules: a nonce page gets no policy header from next.config", () => {
  // On Vercel the render sees these response headers, and Next.js reads the
  // nonce from the first policy header it finds. One without the nonce
  // (seen live Nov 28: the frame-only policy) leaves every script tag bare.
  const rules = configHeaderRules();
  assert.equal(rules.length, 2);
  for (const path of ["/admin", "/admin/ship/orders", "/pickem"]) {
    for (const rule of rules) {
      const matches = rule.source === "/:path*" || new RegExp(`^${rule.source}$`).test(path);
      if (!matches) continue;
      for (const h of rule.headers) {
        assert.ok(!/^content-security-policy/i.test(h.key), `${rule.source} sends ${h.key} to ${path}`);
      }
    }
  }
  // Every response still gets the basic set, framing included.
  assert.deepEqual(rules[0], { source: "/:path*", headers: BASE_HEADERS });
  assert.ok(BASE_HEADERS.some((h) => h.key === "X-Frame-Options" && h.value === "DENY"));
});

test("config rules: every other page gets the full policy and the frame rule", () => {
  const [, rule] = configHeaderRules();
  assert.equal(rule.source, STATIC_CSP_SOURCE);
  assert.deepEqual(rule.headers, staticPolicyHeaders());
  assert.deepEqual(staticPolicyHeaders(), [...frameGuardHeaders(), ...cspHeaders()]);
  assert.ok(!rule.headers.some((h) => h.value.includes("nonce-")));
});
