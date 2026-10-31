import type { NextRequest } from "next/server";
import { authorizeJob } from "@/lib/job-auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import { buyerFirstName, ordersToInvite, reviewRequestEmail, reviewUrl } from "@/lib/review";
import { serviceSupabase } from "@/lib/supabase-service";
import type { Order, ReviewInvite, Shipment } from "@/lib/supabase";

// Daily on the Vercel cron (vercel.json): email a private review link to
// each buyer whose box went out 10-30 days ago (see ordersToInvite). Only
// buyers with an email on file — Reddit buyers get their link from "Copy
// review link" in the admin. The invite row is written before the email so
// a buyer is never asked twice; a failed send removes it to retry tomorrow.
// ?dry=1 lists who would be emailed without sending.
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  if (!dry && !emailConfigured()) {
    return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });
  }
  try {
    const supabase = serviceSupabase();
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, status, buyer_email, buyer_username, ship_to")
      .eq("status", "paid")
      .not("buyer_email", "is", null);
    if (ordersError) throw new Error(ordersError.message);
    const ids = (orders ?? []).map((o) => o.id as number);
    if (ids.length === 0) return Response.json({ dry, due: [], sent: [], failed: [] });

    const [{ data: shipments, error: shipError }, { data: invites, error: invError }] =
      await Promise.all([
        supabase.from("shipments").select("order_id, sent_at").in("order_id", ids),
        supabase.from("review_invites").select("order_id").in("order_id", ids),
      ]);
    if (shipError) throw new Error(shipError.message);
    if (invError) throw new Error(invError.message);

    const due = ordersToInvite(
      orders as Pick<Order, "id" | "status" | "buyer_email">[],
      (shipments ?? []) as Pick<Shipment, "order_id" | "sent_at">[],
      (invites ?? []) as Pick<ReviewInvite, "order_id">[]
    );
    if (dry) return Response.json({ dry, due, sent: [], failed: [] });

    const byId = new Map((orders ?? []).map((o) => [o.id as number, o]));
    const sent: number[] = [];
    const failed: { orderId: number; error: string }[] = [];
    for (const d of due) {
      const { data: invite, error: insertError } = await supabase
        .from("review_invites")
        .insert({ order_id: d.orderId, email: d.email })
        .select("id, token")
        .single();
      if (insertError || !invite) {
        failed.push({ orderId: d.orderId, error: insertError?.message ?? "insert failed" });
        continue;
      }
      const order = byId.get(d.orderId) as Pick<Order, "ship_to" | "buyer_email" | "buyer_username">;
      const result = await sendEmail(
        reviewRequestEmail({
          to: d.email,
          firstName: buyerFirstName(order),
          url: reviewUrl(invite.token as string),
        })
      );
      if (!result.ok) {
        await supabase.from("review_invites").delete().eq("id", invite.id);
        failed.push({ orderId: d.orderId, error: result.error });
        continue;
      }
      await supabase
        .from("review_invites")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", invite.id);
      sent.push(d.orderId);
    }
    if (due.length > 0) {
      console.log(
        `review-requests: due ${due.length}, sent ${sent.length}` +
          `${failed.length ? `, failed ${failed.map((f) => `#${f.orderId}: ${f.error}`).join("; ")}` : ""}`
      );
    }
    return Response.json({ dry, due, sent, failed });
  } catch (e) {
    console.error("review-requests failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: e instanceof Error ? e.message : "run failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
