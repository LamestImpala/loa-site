import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { LOA_HOST, OLD_SHOP_HOST, SHOP_HOST, matchesHost } from "@/lib/hosts";

function stripPort(host: string) {
  return host.split(":")[0];
}

export function proxy(request: NextRequest) {
  const host = stripPort(request.headers.get("host") ?? "");
  const { pathname } = request.nextUrl;
  const isShopHost = matchesHost(host, SHOP_HOST);
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

    // Serve the (shop) subtree; anything outside it belongs to LOA.
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/records" : `/records${pathname}`;
    return NextResponse.rewrite(url);
  }

  // The shop moved to its own domain. Localhost keeps /records reachable for dev.
  if (isLoaHost && (pathname === "/records" || pathname.startsWith("/records/"))) {
    return NextResponse.redirect(new URL(`https://${SHOP_HOST}/`), 308);
  }

  return NextResponse.next();
}

export const config = {
  // _vercel is excluded so the analytics beacon (POST /_vercel/insights/view, no dot in
  // the path) isn't rewritten to /records/... on the shop host and lost.
  matcher: ["/((?!_next|_vercel|api|images|favicon\\.ico|.*\\..*).*)"],
};
