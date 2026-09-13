import type { DbRecord } from "@/lib/supabase";

// A 48h hold that hasn't expired yet. hold_until is public (the shop drops
// held records from bundles); hold_buyer is admin-only.
export const holdActive = (r: DbRecord) =>
  !!r.hold_until && new Date(r.hold_until).getTime() > Date.now();
