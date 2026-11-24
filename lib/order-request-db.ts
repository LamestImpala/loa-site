import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderRequestBody } from "./order-request.ts";
import { overLimit } from "./rate-limit.ts";

// Saving a "Request to buy" (/api/order-request, both channels). The route
// is the only way in: the public key can no longer insert into
// order_requests, so every request passes these per-visitor limits before
// the service role writes it. The validate_order_request trigger still
// checks the ids, recomputes the totals and keeps a shop-wide hourly cap.
//
// The trigger enforces these same two limits again, one request at a time
// under a lock. The check here reads, then writes, so a burst of parallel
// requests could all read "under the limit" at once; the trigger is what
// holds then. Keep the two numbers in sync with the newest
// validate_order_request in supabase/migrations/.

// One visitor (hashed IP, see rate-limit.ts) may save this many an hour.
// The busiest hour the shop has seen held three requests from everyone.
export const PER_VISITOR_HOUR = 5;
// One address may be sent this many confirmation emails a day, however
// many visitors ask: the form can't be used to pester an inbox.
export const PER_EMAIL_DAY = 3;

const HOUR_MS = 60 * 60 * 1000;
const BUSY = "Too many requests right now — please try again in a bit.";

export type SaveResult = { ok: true } | { ok: false; status: number; error: string };

type DbError = { message?: string; code?: string };

// The database doesn't have the ip_hash column until this change's
// migration is applied, which happens after the code is live.
function missingColumn(e: DbError): boolean {
  return e.code === "PGRST204" || e.code === "42703";
}

export async function saveOrderRequest(
  db: SupabaseClient,
  body: OrderRequestBody,
  opts: { refCode: string; visitor: string; now?: number }
): Promise<SaveResult> {
  const now = opts.now ?? Date.now();
  const table = "order_requests";
  if (
    await overLimit(
      db,
      { table, column: "ip_hash", value: opts.visitor, windowMs: HOUR_MS, max: PER_VISITOR_HOUR },
      now
    )
  ) {
    return { ok: false, status: 429, error: BUSY };
  }
  if (
    body.channel === "email" &&
    (await overLimit(
      db,
      {
        table,
        column: "buyer_email",
        value: body.buyerEmail,
        windowMs: 24 * HOUR_MS,
        max: PER_EMAIL_DAY,
      },
      now
    ))
  ) {
    return { ok: false, status: 429, error: BUSY };
  }

  const row: Record<string, unknown> =
    body.channel === "email"
      ? {
          ref_code: opts.refCode,
          record_ids: body.recordIds,
          channel: "email",
          buyer_name: body.buyerName,
          buyer_email: body.buyerEmail,
          message: body.message,
        }
      : {
          ref_code: opts.refCode,
          record_ids: body.recordIds,
          channel: "reddit",
          buyer_username: body.buyerUsername,
        };
  // No .select(): nothing here needs the row back.
  let { error } = await db.from(table).insert({ ...row, ip_hash: opts.visitor });
  if (error && missingColumn(error)) ({ error } = await db.from(table).insert(row));
  if (!error) return { ok: true };

  const msg = error.message || "";
  if (/rate limited/i.test(msg)) return { ok: false, status: 429, error: BUSY };
  if (/no valid records/i.test(msg)) {
    return { ok: false, status: 409, error: "Those records are no longer available." };
  }
  if (/email required|too many records/i.test(msg)) {
    return { ok: false, status: 400, error: "Enter a valid email address" };
  }
  console.error("order-request insert failed:", msg);
  return { ok: false, status: 502, error: "Couldn't save the request" };
}
