import type { DbRecord } from "../supabase.ts";

// A 48h hold that hasn't expired yet. hold_until is public (the shop drops
// held records from bundles); hold_buyer is admin-only. `now` is injectable
// for tests.
export const holdActive = (r: DbRecord, now: number = Date.now()) =>
  !!r.hold_until && new Date(r.hold_until).getTime() > now;
