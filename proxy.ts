import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { LOA_HOST, OLD_SHOP_HOST, SHOP_HOST, matchesHost } from "@/lib/hosts";
import { contentSecurityPolicy, cspHeaders, needsNonce, newNonce } from "@/lib/security-headers";

const dev = process.env.NODE_ENV === "development";

function stripPort(host: string) {
  return host.split(":")[0];
}

export function proxy(request: NextRequest) {
  const host = stripPort(request.headers.get("host") ?? "");
  const { pathname } = request.nextUrl;
  // shop.localhost (browsers resolve *.localhost to 127.0.0.1) serves the
  // shop at its real paths during development, so /r/… links work locally.
  const isShopHost =
    matchesHost(host, SHOP_HOST) ||
    (process.env.NODE_ENV === "development" && host === "shop.localhost");
  const isOldShopHost = matchesHost(host, OLD_SHOP_HOST);
  const isLoaHost = matchesHost(host, LOA_HOST);

  // The Bee's Knees Records became Curiouser Records; forward the old domain.
  if (isOldShopHost) {
    return NextResponse.redirect(
      new URL(pathname + request.nextUrl.search, `https://${SHOP_HOST}`),
      308
    );
  }

  if (isShopHost) {
    // Canonical host is the apex; www serves a redirect, not a copy.
    if (host === `www.${SHOP_HOST}`) {
      return NextResponse.redirect(
        new URL(pathname + request.nextUrl.search, `https://${SHOP_HOST}`),
        308
      );
    }

    // Canonical shop URL is the domain root, not /records.
    if (pathname === "/records" || pathname.startsWith("/records/")) {
      const url = request.nextUrl.clone();
      url.pathname = pathname.slice("/records".length) || "/";
      return NextResponse.redirect(url, 308);
    }

    // The admin lives on the LOA host only. Older notification emails
    // linked to it here; forward them (the browser keeps the #hash).
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      return NextResponse.redirect(
        new URL(pathname + request.nextUrl.search, `https://www.${LOA_HOST}`),
        307
      );
    }

    // Serve the (shop) subtree; anything outside it belongs to LOA.
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/records" : `/records${pathname}`;
    const response = NextResponse.rewrite(url);
    // next.config.ts leaves the policy off /admin and /pickem for every
    // host. On the shop those paths are ordinary shop pages (a not-found),
    // so they get the same policy as the rest of the shop here.
    if (needsNonce(pathname)) {
      for (const h of cspHeaders({ dev })) response.headers.set(h.key, h.value);
    }
    return response;
  }

  // The shop moved to its own domain. Localhost keeps /records reachable for dev.
  if (isLoaHost && (pathname === "/records" || pathname.startsWith("/records/"))) {
    return NextResponse.redirect(new URL(`https://${SHOP_HOST}/`), 308);
  }

  // The admin and pick'em get a content security policy with a fresh nonce
  // on every request. Next.js reads the policy from the request headers
  // while rendering and puts the nonce on its own script tags; the browser
  // gets the same policy on the response.
  if (needsNonce(pathname)) {
    const nonce = newNonce();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("content-security-policy-report-only");
    requestHeaders.set("content-security-policy", contentSecurityPolicy({ nonce, dev }));
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const h of cspHeaders({ nonce, dev })) response.headers.set(h.key, h.value);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // _vercel is excluded so the analytics beacon (POST /_vercel/insights/view, no dot in
  // the path) isn't rewritten to /records/... on the shop host and lost.
  matcher: ["/((?!_next|_vercel|api|images|favicon\\.ico|.*\\..*).*)"],
};
