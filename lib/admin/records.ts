import type { DbRecord } from "../supabase.ts";
import { kindOf } from "../items.ts";

// A hold that hasn't expired yet. hold_until is public (the shop drops
// held records from bundles and shows them On hold); hold_buyer is
// admin-only. `now` is injectable for tests.
export const holdActive = (r: DbRecord, now: number = Date.now()) =>
  !!r.hold_until && new Date(r.hold_until).getTime() > now;

// A sent invoice holds its records until it is paid or cancelled, not for
// 48h: while the buyer can still pay, the record must not look available
// anywhere. The shop can only read hold_until, so the invoice hold is a
// date that never comes. Paying (soldPatch) or cancelling (the invoice
// DELETE route) clears it.
export const INVOICE_HOLD_UNTIL = "9999-12-31T00:00:00.000Z";

export const invoiceHold = (r: Pick<DbRecord, "hold_until">) =>
  !!r.hold_until && new Date(r.hold_until).getUTCFullYear() >= 9999;

// Words for how long a hold lasts, for the admin's pills and drawer.
export const holdUntilText = (r: Pick<DbRecord, "hold_until">) =>
  invoiceHold(r)
    ? "until the invoice is paid or cancelled"
    : `until ${new Date(r.hold_until as string).toLocaleString()}`;

// Off the market for now: sold, or held for a buyer (a running hold or a
// live invoice). Reddit tables and the daily price run skip these.
export const reserved = (r: DbRecord, now: number = Date.now()) =>
  r.sold || holdActive(r, now);

// A draft: added in the admin, never yet on the shop. Publishing clears
// the flag for good — a record hidden later is just hidden.
export const isDraft = (r: Pick<DbRecord, "draft" | "listed" | "sold">) =>
  r.draft === true && !r.listed && !r.sold;

// What publishing writes.
export const PUBLISH_PATCH = { listed: true, draft: false } as const;

// Why a draft can't go on the shop yet, or null when it can. The shop
// would show a $0 price tag, and a record with no grade says nothing
// about the copy.
export function publishBlock(
  r: Pick<DbRecord, "kind" | "price" | "media" | "sleeve">
): string | null {
  if (!(Number(r.price) > 0)) return "set a price above $0 first";
  if (kindOf(r) === "record" && (!r.media || !r.sleeve)) return "grade the media and sleeve first";
  return null;
}

// The daily price run publishes a draft on its own when it is a record
// with a Discogs release, still at $0 and not hand-priced. Past the grace
// period it has had its run and Discogs had no price for it, so it is the
// owner's to price.
export const PRICE_RUN_GRACE_HOURS = 36;

export function awaitsPriceRun(r: DbRecord, now: number = Date.now()) {
  if (!isDraft(r) || kindOf(r) !== "record") return false;
  if (r.discogs_release_id == null || r.manual_price || Number(r.price) !== 0) return false;
  const added = r.created_at ? new Date(r.created_at).getTime() : now;
  return now - added < PRICE_RUN_GRACE_HOURS * 3600 * 1000;
}

// Items at or above this price on the shop without photos of the actual
// copy get an "Add photos" nudge in the catalog: buyers want to see the
// copy before paying real money, and the shop otherwise shows a stock cover.
export const PHOTO_NUDGE_PRICE = 40;

export function needsPhotos(r: Pick<DbRecord, "price" | "photo_urls" | "sold" | "listed">) {
  return r.listed && !r.sold && r.price >= PHOTO_NUDGE_PRICE && !(r.photo_urls ?? []).length;
}
