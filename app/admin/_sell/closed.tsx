"use client";

import { useState } from "react";
import type { OrderRequest, ShopMessage } from "@/lib/supabase";
import { messageSummary } from "@/lib/admin/messages";
import { useAdmin, useSlice } from "../_shell/admin-provider";
import { EmptyState, Pill } from "../_shell/primitives";
import { buttonClass, timeAgo } from "../_shell/ui";

// Closed: what left the open list — requests closed or dismissed, and
// archived mail — so nothing is gone for good once its Undo toast fades.
// Loaded only when this view is opened; the newest 50 of each.
export function Closed() {
  const { closedRequests, closedMessages, restoreRequest, restoreMessages, pushToast } =
    useAdmin();
  const requestsStatus = useSlice("closedRequests");
  const messagesStatus = useSlice("closedMessages");
  const [busy, setBusy] = useState<string | null>(null);

  async function reopen(req: OrderRequest) {
    setBusy(`request-${req.id}`);
    try {
      if (await restoreRequest(req)) {
        pushToast("success", `Request ${req.ref_code} is back under Conversations ✓`);
      }
    } finally {
      setBusy(null);
    }
  }

  async function restore(m: ShopMessage) {
    setBusy(`message-${m.id}`);
    try {
      if (await restoreMessages([{ ...m, status: "read" }])) {
        pushToast(
          "success",
          `Message from ${m.from_name || m.from_email} is back under Conversations ✓`
        );
      }
    } finally {
      setBusy(null);
    }
  }

  const buyerOf = (req: OrderRequest) =>
    req.channel === "email"
      ? [req.buyer_name, req.buyer_email].filter(Boolean).join(" · ")
      : req.buyer_username
        ? `u/${req.buyer_username}`
        : "no username given";

  return (
    <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:items-start">
      <section aria-labelledby="closed-requests">
        <h2 id="closed-requests" className="text-xl font-medium">
          Closed requests{" "}
          <span className="text-sm text-neutral-400">({closedRequests.length})</span>
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Sold, closed by hand or dismissed. Reopen one to put it back under
          Conversations with its emails.
        </p>
        {requestsStatus !== "loaded" && closedRequests.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            {requestsStatus === "error" ? "Couldn’t load — try Refresh." : "Loading…"}
          </p>
        ) : closedRequests.length === 0 ? (
          <EmptyState>No closed requests yet.</EmptyState>
        ) : (
          <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
            {closedRequests.map((req) => (
              <li key={req.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-amber-300">{req.ref_code}</span>
                  <Pill tone={req.status === "dismissed" ? "neutral" : "green"}>
                    {req.status === "dismissed" ? "dismissed" : "closed"}
                  </Pill>
                  <span className="text-white">{buyerOf(req)}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {timeAgo(req.updated_at)}
                  </span>
                </div>
                <p className="mt-1 text-neutral-400">
                  {req.items.map((it) => `${it.artist} — ${it.title}`).join(", ") ||
                    `${req.record_ids.length} records`}{" "}
                  · ${req.total}
                </p>
                <button
                  type="button"
                  className={`mt-2 ${buttonClass}`}
                  disabled={busy !== null}
                  onClick={() => reopen(req)}
                >
                  {busy === `request-${req.id}` ? "Reopening…" : "Reopen"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="closed-messages">
        <h2 id="closed-messages" className="text-xl font-medium">
          Archived mail{" "}
          <span className="text-sm text-neutral-400">({closedMessages.length})</span>
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Mail to orders@ you archived, or that was filed away with its
          request. Restore one to answer it again.
        </p>
        {messagesStatus !== "loaded" && closedMessages.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            {messagesStatus === "error" ? "Couldn’t load — try Refresh." : "Loading…"}
          </p>
        ) : closedMessages.length === 0 ? (
          <EmptyState>No archived mail yet.</EmptyState>
        ) : (
          <ul className="mt-3 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/5">
            {closedMessages.map((m) => (
              <li key={m.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-white">{m.from_name || m.from_email}</span>
                  {m.ref_code ? (
                    <span className="font-mono text-xs text-amber-300">{m.ref_code}</span>
                  ) : null}
                  <span className="ml-auto text-xs text-neutral-500">
                    {timeAgo(m.received_at)}
                  </span>
                </div>
                <p className="mt-1 text-neutral-300">
                  {m.subject?.trim() || <span className="text-neutral-500">(no subject)</span>}
                </p>
                <p className="mt-1 text-neutral-400">
                  {messageSummary(m, 160) || "(empty message)"}
                </p>
                <button
                  type="button"
                  className={`mt-2 ${buttonClass}`}
                  disabled={busy !== null}
                  onClick={() => restore(m)}
                >
                  {busy === `message-${m.id}` ? "Restoring…" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
