// Host constants shared by the edge proxy (proxy.ts) and client components.
// Keep this module dependency-free: it is imported into the browser bundle.

export const SHOP_HOST = "curiouserrecords.com";
export const OLD_SHOP_HOST = "thebeeskneesrecords.com";
export const LOA_HOST = "lateonsetaudiophile.com";

/**
 * Path prefix the (shop) route group is served under inside the app dir.
 * Also doubles as the Web Analytics namespace for shop traffic, so a real page
 * at app/(loa)/records/ would collide with it in the requestPath dimension.
 */
export const SHOP_PATH_PREFIX = "/records";

/** True for the apex host and its www. alias. `host` must already be port-stripped. */
export function matchesHost(host: string, canonical: string) {
  return host === canonical || host === `www.${canonical}`;
}

/**
 * Rewrite a browser URL on the shop host to the path the shop is actually served
 * from, mirroring the rewrite in proxy.ts. Other hosts are returned unchanged.
 *
 * Both domains report into one Vercel project, and the shop's rewrite is server-side
 * (the browser URL stays at "/"), so without this both homepages report as "/" and
 * become impossible to tell apart in Web Analytics.
 */
export function shopNamespacedUrl(href: string) {
  const url = new URL(href);
  if (!matchesHost(url.hostname, SHOP_HOST)) return href;
  if (
    url.pathname === SHOP_PATH_PREFIX ||
    url.pathname.startsWith(`${SHOP_PATH_PREFIX}/`)
  ) {
    return href;
  }
  url.pathname =
    url.pathname === "/"
      ? SHOP_PATH_PREFIX
      : `${SHOP_PATH_PREFIX}${url.pathname}`;
  return url.toString();
}
