import type { DbRecord } from "../supabase.ts";

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
