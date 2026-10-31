"use client";

import { useMemo, useState } from "react";
import type { ReviewStatus, ShopReview } from "@/lib/supabase";
import { reviewUrl, SOURCE_LABELS, stars } from "@/lib/review";
import {
  askableOrders,
  IMPORT_SOURCES,
  parseImportedReview,
  recordsByOrder,
} from "@/lib/admin/reviews";
import {
  addImportedReview,
  ensureReviewInvite,
  updateReview,
  type ReviewPatch,
} from "@/lib/admin/reviews-db";
import { buyerLabel } from "@/lib/admin/buyers";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, inputClass, smallButtonClass, timeAgo, useCopied } from "../_shell/ui";

// The Inbox's Reviews section. Buyer reviews arrive pending (from the
// emailed or copied /review link) and go public only when published;
// featured ones are quoted first on the shop home. Reviews from Discogs,
// eBay or Reddit are typed in below and go live at once. "Ask for a
// review" lists recent buyers: email buyers get the link automatically
// ten days after drop-off; anyone's link can be copied into a DM.

const STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: "border-amber-400/40 text-amber-300",
  published: "border-emerald-500/40 text-emerald-300",
  hidden: "border-white/15 text-neutral-400",
};

const emptyImport = {
  source: "discogs",
  sourceUrl: "",
  reviewerName: "",
  rating: "5",
  body: "",
  reviewedOn: "",
};

export function ReviewsSection() {
  const {
    supabase,
    reviews,
    setReviews,
    reviewInvites,
    setReviewInvites,
    orders,
    shipments,
    records,
    pushToast,
    copyText,
  } = useAdmin();
  const { isCopied, flash } = useCopied();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [replyOpen, setReplyOpen] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [importForm, setImportForm] = useState(emptyImport);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const pending = reviews.filter((r) => r.status === "pending");
  const shown = reviews.filter((r) => r.status !== "pending" && (showHidden || r.status !== "hidden"));
  const hiddenCount = reviews.filter((r) => r.status === "hidden").length;
  const published = reviews.filter((r) => r.status === "published");
  const rated = published.filter((r) => r.rating != null);
  const average = rated.length
    ? rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length
    : null;

  const askable = useMemo(
    () => askableOrders(orders, shipments, reviewInvites, reviews),
    [orders, shipments, reviewInvites, reviews]
  );
  const bought = useMemo(() => recordsByOrder(records), [records]);

  // What the buyer bought, one "Artist — Title" per line.
  function boughtList(orderId: number | null) {
    const list = orderId == null ? [] : bought.get(orderId) ?? [];
    if (list.length === 0) return null;
    return (
      <ul className="mt-1 basis-full text-xs text-neutral-400">
        {list.map((r) => (
          <li key={r.id}>
            {r.artist} — {r.title}
          </li>
        ))}
      </ul>
    );
  }

  async function save(r: ShopReview, patch: ReviewPatch, done?: string) {
    setBusyId(r.id);
    try {
      const saved = await updateReview(supabase, r.id, patch);
      setReviews((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
      if (done) pushToast("success", done);
      return true;
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Couldn't save the review");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(orderId: number) {
    try {
      const invite = await ensureReviewInvite(supabase, orderId);
      setReviewInvites((prev) =>
        prev.some((i) => i.id === invite.id) ? prev : [invite, ...prev]
      );
      const url = reviewUrl(invite.token);
      if (await copyText(url, "Review link")) flash(`review-${orderId}`);
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Couldn't make the review link");
    }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseImportedReview(importForm);
    if (!parsed.ok) {
      pushToast("error", parsed.error);
      return;
    }
    setImporting(true);
    try {
      const saved = await addImportedReview(supabase, parsed.row);
      setReviews((prev) => [saved, ...prev]);
      setImportForm(emptyImport);
      pushToast("success", "Review added and published ✓");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Couldn't save the review");
    } finally {
      setImporting(false);
    }
  }

  function card(r: ShopReview) {
    const busy = busyId === r.id;
    const replying = replyOpen === r.id;
    return (
      <div
        key={r.id}
        className={`rounded-2xl border p-4 ${
          r.status === "pending" ? "border-amber-400/30 bg-white/5" : "border-white/10 bg-white/5"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            defaultValue={r.reviewer_name}
            aria-label="Name shown with the review"
            maxLength={60}
            className={`w-44 ${inputClass} py-1`}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== r.reviewer_name) void save(r, { reviewer_name: v });
              else e.target.value = r.reviewer_name;
            }}
          />
          <span className="text-amber-300" aria-label={r.rating ? `${r.rating} stars` : "no stars"}>
            {r.rating ? stars(r.rating) : "no stars"}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>
            {r.status}
          </span>
          {r.featured ? (
            <span className="rounded-full border border-sky-400/40 px-2 py-0.5 text-xs text-sky-300">
              featured
            </span>
          ) : null}
          <span className="text-xs text-neutral-400">
            {r.source === "site" ? "left on the site" : `from ${SOURCE_LABELS[r.source]}`}
            {r.source_url ? (
              <>
                {" · "}
                <a
                  href={r.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-300 underline-offset-2 hover:underline"
                >
                  original ↗
                </a>
              </>
            ) : null}
          </span>
          <span className="ml-auto text-xs text-neutral-500">
            {r.source === "site" ? timeAgo(r.created_at) : r.reviewed_on}
          </span>
        </div>
        <p className="mt-2 whitespace-pre-line text-sm text-neutral-200">{r.body}</p>
        {boughtList(r.order_id)}
        {r.owner_reply && !replying ? (
          <p className="mt-2 border-l border-white/20 pl-3 text-sm text-neutral-400">
            Your reply: {r.owner_reply}
          </p>
        ) : null}
        {replying ? (
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="A short public reply, shown beneath the review…"
            className={`mt-3 w-full max-w-3xl ${inputClass}`}
          />
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {r.status !== "published" ? (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => save(r, { status: "published" }, "Published ✓")}
            >
              Publish
            </button>
          ) : null}
          {r.status !== "hidden" ? (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => save(r, { status: "hidden", featured: false }, "Hidden")}
            >
              Hide
            </button>
          ) : null}
          {r.status === "published" ? (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => save(r, { featured: !r.featured })}
              title="Featured reviews are quoted first on the shop home"
            >
              {r.featured ? "Unfeature" : "Feature"}
            </button>
          ) : null}
          {replying ? (
            <>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={async () => {
                  if (await save(r, { owner_reply: replyDraft.trim() || null }, "Reply saved ✓")) {
                    setReplyOpen(null);
                  }
                }}
              >
                Save reply
              </button>
              <button type="button" className={buttonClass} onClick={() => setReplyOpen(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setReplyOpen(r.id);
                setReplyDraft(r.owner_reply ?? "");
              }}
            >
              {r.owner_reply ? "Edit reply" : "Reply"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <h2 id="reviews" className="mt-10 scroll-mt-24 text-xl font-medium">
        Reviews{" "}
        {pending.length > 0 ? (
          <span className="text-sm text-amber-400">({pending.length} to publish)</span>
        ) : (
          <span className="text-sm text-neutral-400">
            ({published.length} published
            {average != null ? ` · ${average.toFixed(1)} avg` : ""})
          </span>
        )}
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Buyer reviews wait here until you publish them; published ones show on
        the shop home as a rating and up to three quotes, featured first.
      </p>

      {pending.length > 0 ? (
        <div className="mt-3 grid gap-3">{pending.map(card)}</div>
      ) : (
        <p className="mt-3 text-sm text-neutral-400">No reviews waiting.</p>
      )}

      <h3 className="mt-6 text-lg font-medium">Ask for a review</h3>
      <p className="mt-1 text-sm text-neutral-400">
        Buyers whose boxes went out in the last 60 days. Email buyers get their
        link automatically 10 days after drop-off; copy a link to paste into a
        Reddit DM.
      </p>
      {askable.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">Nobody to ask right now.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {askable.map((a) => (
            <li
              key={a.order.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
            >
              <span className="font-medium text-white">
                {buyerLabel(a.order.buyer_username, a.order.buyer_email)}
              </span>
              <span className="text-xs text-neutral-500">
                order #{a.order.id} · dropped off {timeAgo(a.lastSent)}
              </span>
              <span className="text-xs text-neutral-400">
                {a.invite?.sent_at
                  ? `emailed ${timeAgo(a.invite.sent_at)}`
                  : a.invite
                    ? "link copied"
                    : a.autoEmailOn
                      ? `emails ${new Date(a.autoEmailOn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : "no email on file"}
              </span>
              <button
                type="button"
                className={`ml-auto ${smallButtonClass}`}
                onClick={() => copyLink(a.order.id)}
              >
                {isCopied(`review-${a.order.id}`) ? "Copied!" : "Copy review link"}
              </button>
              {boughtList(a.order.id)}
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-6 text-lg font-medium">
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          aria-expanded={importOpen}
          className="text-left transition hover:text-amber-200"
        >
          Add a review from Discogs, eBay or Reddit {importOpen ? "▾" : "▸"}
        </button>
      </h3>
      {importOpen ? (
        <form onSubmit={submitImport} className="mt-3 grid max-w-3xl gap-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={importForm.source}
              onChange={(e) => setImportForm({ ...importForm, source: e.target.value })}
              className={inputClass}
              aria-label="Where it was left"
            >
              {IMPORT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s] === "elsewhere" ? "Other" : SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <input
              value={importForm.reviewerName}
              onChange={(e) => setImportForm({ ...importForm, reviewerName: e.target.value })}
              placeholder="Name or handle"
              maxLength={60}
              className={`w-48 ${inputClass}`}
            />
            <select
              value={importForm.rating}
              onChange={(e) => setImportForm({ ...importForm, rating: e.target.value })}
              className={inputClass}
              aria-label="Stars"
            >
              {["5", "4", "3", "2", "1"].map((n) => (
                <option key={n} value={n}>
                  {stars(Number(n))}
                </option>
              ))}
              <option value="">No stars</option>
            </select>
            <input
              type="date"
              value={importForm.reviewedOn}
              onChange={(e) => setImportForm({ ...importForm, reviewedOn: e.target.value })}
              className={inputClass}
              aria-label="Date left"
            />
          </div>
          <input
            value={importForm.sourceUrl}
            onChange={(e) => setImportForm({ ...importForm, sourceUrl: e.target.value })}
            placeholder="Link to the original (optional)"
            className={inputClass}
          />
          <textarea
            value={importForm.body}
            onChange={(e) => setImportForm({ ...importForm, body: e.target.value })}
            rows={3}
            maxLength={1200}
            placeholder="What they wrote"
            className={inputClass}
          />
          <div>
            <button type="submit" className={buttonClass} disabled={importing}>
              {importing ? "Saving…" : "Add and publish"}
            </button>
          </div>
        </form>
      ) : null}

      {shown.length > 0 || hiddenCount > 0 ? (
        <>
          <h3 className="mt-6 flex flex-wrap items-baseline gap-3 text-lg font-medium">
            All reviews
            {hiddenCount > 0 ? (
              <button
                type="button"
                className="text-sm font-normal text-neutral-400 hover:text-neutral-200"
                onClick={() => setShowHidden((v) => !v)}
              >
                {showHidden ? "Hide hidden" : `Show ${hiddenCount} hidden`}
              </button>
            ) : null}
          </h3>
          <div className="mt-3 grid gap-3">{shown.map(card)}</div>
        </>
      ) : null}
    </>
  );
}
