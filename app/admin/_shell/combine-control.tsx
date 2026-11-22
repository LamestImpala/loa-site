"use client";

import { useState } from "react";
import type { Order } from "@/lib/supabase";
import {
  combineCandidates,
  combineSupported,
  orderNumbers,
  saleMates,
  splitPlan,
} from "@/lib/admin/combined";
import { buyerLabel } from "@/lib/admin/buyers";
import { useAdmin } from "./admin-provider";
import { smallButtonClass } from "./ui";

// Combine a paid order with another from the same buyer (two invoices,
// one sale) so the review is asked once for both — or split a combined
// sale back up. Shown on an "Ask for a review" row and on the order card.
// Renders one of: "Combined with #27 · Split", a "Same buyer as #27 ·
// Combine" button when another order looks like the same buyer, or a
// quiet "Combine with…" picker of the other paid orders.
export function CombineControl({
  order,
  variant = "card",
}: {
  order: Order;
  // "row" = the Reviews row already names the sale's orders, so a combined
  // sale shows only Split.
  variant?: "card" | "row";
}) {
  const { orders, combineOrders, splitOrder, confirm } = useAdmin();
  const [busy, setBusy] = useState(false);
  if (!combineSupported(order) || order.status !== "paid") return null;

  const label = (o: Order) => buyerLabel(o.buyer_username, o.buyer_email);

  async function combineWith(other: Order, ids: number[]) {
    const ok = await confirm(
      `Combine order #${order.id} with ${ids.length > 1 ? "orders" : "order"} ${orderNumbers(ids)} (${label(other)}) into one sale? ` +
        "They'll share one review request and one review. Each order keeps its own invoice and boxes, and you can split them again.",
      "Combine"
    );
    if (!ok) return;
    setBusy(true);
    await combineOrders(order, other);
    setBusy(false);
  }

  const mates = saleMates(order, orders);
  if (mates.length > 0) {
    const leaving = splitPlan(orders, order.id);
    const others = orderNumbers(mates.map((o) => o.id));
    async function split() {
      const ok = await confirm(
        leaving.length === 1 && leaving[0] === order.id && mates.length > 1
          ? `Take order #${order.id} out of its sale with ${others}? It gets its own review request again.`
          : `Split order #${order.id} from ${others}? Each order gets its own review request again.`,
        "Split"
      );
      if (!ok) return;
      setBusy(true);
      await splitOrder(order);
      setBusy(false);
    }
    return (
      <span className="text-xs text-neutral-500">
        {variant === "card" ? <>Combined with {others} · </> : null}
        <button
          type="button"
          onClick={split}
          disabled={busy}
          title="Undo the combine: each order is its own sale again, with its own review request"
          className="underline underline-offset-2 transition hover:text-white disabled:opacity-40"
        >
          Split
        </button>
      </span>
    );
  }

  const candidates = combineCandidates(order, orders);
  if (candidates.length === 0) return null;
  const match = candidates.find((c) => c.same);
  if (match) {
    return (
      <button
        type="button"
        onClick={() => combineWith(match.order, match.ids)}
        disabled={busy}
        title="Looks like the same buyer paying on two invoices. Combine them into one sale: one review request, one review"
        className={smallButtonClass}
      >
        Same buyer as {orderNumbers(match.ids)} · Combine
      </button>
    );
  }
  return (
    <select
      value=""
      disabled={busy}
      onChange={(e) => {
        const picked = candidates.find((c) => c.order.id === Number(e.target.value));
        if (picked) void combineWith(picked.order, picked.ids);
      }}
      aria-label={`Combine order #${order.id} with another order`}
      title="Tie this order to another from the same buyer, so the review is asked once for both"
      className="max-w-44 rounded-md border border-white/10 bg-transparent px-1.5 py-1 text-xs text-neutral-500 transition hover:text-neutral-300 focus:border-white/30 focus:outline-none disabled:opacity-40"
    >
      <option value="">Combine with…</option>
      {candidates.map((c) => (
        <option key={c.order.id} value={c.order.id}>
          {orderNumbers(c.ids)} · {label(c.order)} ·{" "}
          {new Date(c.order.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </option>
      ))}
    </select>
  );
}
