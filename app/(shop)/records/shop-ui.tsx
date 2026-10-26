"use client";

/*
 * Client pieces shared by the catalog grid (records-client.tsx) and the
 * per-record page (r/[slug]): interest tracking, the bundle (kept in
 * localStorage so it survives a refresh and the trip to a record page),
 * the bundle bar, the "Request to buy" sheet and the photo lightbox.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  FREE_SHIPPING_MIN,
  SELLER_INFO,
  bundleBreakdown,
  combinedShipping,
  makeRefCode,
} from "@/lib/records";
import { isOnHold } from "@/lib/record-info";
import { getBrowserSupabase, type DbRecord } from "@/lib/supabase";

// ── Interest tracking ────────────────────────────────────────────────────

export type TrackEvent = "photo_open" | "discogs_click" | "bundle_add" | "buy_request";
// Suppress repeat interest events within a page load; cross-visit repeats are
// absorbed by distinct-session counting on the admin side.
const sentEvents = new Set<string>();

function trackingSessionId(): string {
  let sid = localStorage.getItem("cr_session_id");
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem("cr_session_id", sid);
  }
  return sid;
}

export function track(recordId: number, event: TrackEvent) {
  try {
    // Set by /admin so the owner's own browsing doesn't count.
    if (localStorage.getItem("cr_no_track")) return;
    const key = `${recordId}:${event}`;
    if (event !== "buy_request") {
      if (sentEvents.has(key)) return;
      sentEvents.add(key);
    }
    const payload = JSON.stringify({
      record_id: recordId,
      event,
      session_id: trackingSessionId(),
    });
    // sendBeacon survives the new-tab navigation on "Request to buy".
    const blob = new Blob([payload], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/track", blob)) {
      fetch("/api/track", {
        method: "POST",
        body: payload,
        keepalive: true,
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
    }
  } catch {
    // Tracking must never break the shop.
  }
}

// ── Cover placeholders ───────────────────────────────────────────────────

export function initials(artist: string) {
  return artist
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// Deterministic accent tint per artist so placeholder covers vary.
const TINTS = [
  { bg: "var(--color-accent-200)", text: "var(--color-accent-800)" },
  { bg: "var(--color-accent-2-200)", text: "var(--color-accent-2-800)" },
  { bg: "var(--color-neutral-200)", text: "var(--color-neutral-800)" },
  { bg: "var(--color-accent-300)", text: "var(--color-accent-900)" },
  { bg: "var(--color-accent-2-300)", text: "var(--color-accent-2-900)" },
  { bg: "var(--color-neutral-300)", text: "var(--color-neutral-900)" },
];

export function tintFor(artist: string) {
  let h = 0;
  for (const ch of artist) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return TINTS[h % TINTS.length];
}

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function onBackdropClick(
  e: React.MouseEvent<HTMLDialogElement>,
  close: () => void
) {
  if (e.target === e.currentTarget) close();
}

// Native <dialog> drives focus trapping and Esc; this keeps it in step
// with React state.
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

// ── Bundle (localStorage-backed, shared across pages and tabs) ───────────

const BUNDLE_KEY = "cr_bundle";
const EMPTY: readonly number[] = [];
let bundleCache: { raw: string | null; ids: readonly number[] } = { raw: null, ids: EMPTY };
const bundleListeners = new Set<() => void>();

function readBundle(): readonly number[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(BUNDLE_KEY);
  } catch {
    return bundleCache.ids; // storage blocked — keep the in-memory bundle
  }
  if (raw === bundleCache.raw) return bundleCache.ids;
  let ids: number[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((n) => Number.isSafeInteger(n));
  } catch {
    // Corrupt value — start over.
  }
  bundleCache = { raw, ids };
  return ids;
}

function writeBundle(ids: number[]) {
  const raw = JSON.stringify(ids);
  bundleCache = { raw, ids };
  try {
    localStorage.setItem(BUNDLE_KEY, raw);
  } catch {
    // Private mode etc. — the bundle still works for this page view.
  }
  bundleListeners.forEach((l) => l());
}

function subscribeBundle(listener: () => void) {
  bundleListeners.add(listener);
  // Another tab changed the bundle.
  const onStorage = (e: StorageEvent) => {
    if (e.key === BUNDLE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bundleListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useBundle(records: DbRecord[]) {
  const ids = useSyncExternalStore(subscribeBundle, readBundle, () => EMPTY);
  const idSet = useMemo(() => new Set(ids), [ids]);
  // Derived from `records` so records that sell or go on hold fall out of
  // the bundle automatically.
  const selectedRecords = useMemo(
    () => records.filter((r) => idSet.has(r.id) && !r.sold && !isOnHold(r)),
    [records, idSet]
  );
  return {
    has: (id: number) => idSet.has(id),
    toggle: (id: number) => {
      const current = readBundle();
      if (current.includes(id)) writeBundle(current.filter((x) => x !== id));
      else {
        track(id, "bundle_add");
        writeBundle([...current, id]);
      }
    },
    clear: () => writeBundle([]),
    selectedRecords,
  };
}

export function BundleBar({
  records,
  onRequest,
  onClear,
}: {
  records: DbRecord[];
  onRequest: () => void;
  onClear: () => void;
}) {
  if (records.length === 0) return null;
  const subtotal = records.reduce((s, r) => s + r.price, 0);
  const shipping = combinedShipping(records.length);
  return (
    <div className="shop-bundle-bar" role="region" aria-label="Your bundle">
      <div className="shop-shell shop-bundle-inner">
        <span className="shop-bundle-summary" aria-live="polite">
          {records.length} record{records.length === 1 ? "" : "s"} · ${subtotal}
          {shipping > 0 ? ` + $${shipping} shipping` : " + free shipping"}{" "}
          <strong>= ${subtotal + shipping}</strong>
        </span>
        <span className="shop-bundle-shipnote">
          {records.length >= FREE_SHIPPING_MIN
            ? "Free shipping unlocked"
            : `Add ${FREE_SHIPPING_MIN - records.length} more for free shipping`}
        </span>
        <button type="button" className="btn btn-primary" onClick={onRequest}>
          Request to buy {records.length}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClear}>
          Clear
        </button>
      </div>
    </div>
  );
}

// ── Request to buy ───────────────────────────────────────────────────────

// DM for one record. The Ref line ties the DM to the order_requests row
// saved when the buyer clicks send, same as the bundle flow.
function singleRequestMessage(r: DbRecord, hasPost: boolean, refCode: string) {
  const subject = `Record purchase: ${r.artist} — ${r.title}`;
  const commentLine = hasPost
    ? "\nI'll also comment on your Reddit post to confirm I sent this DM.\n"
    : "";
  const shipping = combinedShipping(1);
  const message = `Hi! I am interested in purchasing this title from you:\n\n${r.artist} — ${r.title}\n${r.pressing}\nMedia: ${r.media} / Sleeve: ${r.sleeve} — $${r.price}\n$${r.price} + $${shipping} shipping = $${r.price + shipping} total\nRef: ${refCode}\n${commentLine}\n(Found on https://curiouserrecords.com)\n\n`;
  return { subject, message };
}

// One combined DM for a bundle of records; parallels singleRequestMessage but drops
// the pressing line per record to keep the compose URL short. The Ref line
// ties the DM to the order_requests row saved when the buyer clicks send.
function combinedRequestMessage(
  list: DbRecord[],
  hasPost: boolean,
  refCode: string
) {
  const subject = `Record purchase: ${list.length} records from your list`;
  const { lines, subtotal, shipping, total } = bundleBreakdown(list);
  const commentLine = hasPost
    ? "\nI'll also comment on your Reddit post to confirm I sent this DM.\n"
    : "";
  const message = `Hi! I am interested in purchasing these titles from you:\n\n${lines.join(
    "\n"
  )}\n\nSubtotal: $${subtotal}\nShipping: $${shipping}${shipping === 0 ? ` (free on ${FREE_SHIPPING_MIN}+ records)` : ""}\nTotal: $${total}\nRef: ${refCode}\n${commentLine}\n(Found on https://curiouserrecords.com)\n\n`;
  return { subject, message };
}

function composeUrl(subject: string, message?: string) {
  const base = `https://www.reddit.com/message/compose/?to=${SELLER_INFO.redditUsername}&subject=${encodeURIComponent(subject)}`;
  return message === undefined
    ? base
    : `${base}&message=${encodeURIComponent(message)}`;
}

// Fire-and-forget: save the request so /admin can load it by ref code. The
// trigger revalidates ids and recomputes totals server-side; errors are
// swallowed because the DM must go out regardless (paste parser is the
// fallback). No .select() — the anon role has no read access to the table.
function persistOrderRequest(
  refCode: string,
  ids: number[],
  buyerUsername: string
) {
  const buyer = buyerUsername.trim().replace(/^\/?u\//i, "");
  getBrowserSupabase()
    .from("order_requests")
    .insert({
      ref_code: refCode,
      record_ids: ids,
      buyer_username: buyer || null,
    })
    .then(({ error }) => {
      if (error) console.warn("order request not saved:", error.message);
    });
}

// Fallback when the request endpoint is down: a plain email to the shop
// with the same list, which still reaches the admin's inbox.
function mailtoFallback(list: DbRecord[]) {
  const { lines, total } = bundleBreakdown(list);
  const subject = `Record request: ${list.length === 1 ? `${list[0].artist} — ${list[0].title}` : `${list.length} records`}`;
  const body = `Hi! I'd like to buy:\n\n${lines.join("\n")}\n\nTotal: $${total}\n\n(Found on https://curiouserrecords.com)\n`;
  return `mailto:${SELLER_INFO.contactEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// What the buyer is asking to purchase: one record, or the bundle.
export type BuySheet = { kind: "single"; record: DbRecord } | { kind: "bundle" };
type RequestMode = "email" | "reddit";
type EmailStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; refCode: string; email: string }
  | { kind: "error"; message: string };

// The buy sheet quotes one record or the whole bundle with the same math the
// DM itself uses. `onClose(sentBundle)` tells the caller a bundle request
// went out, so it can empty the bundle — those records are spoken for.
export function BuyDialog({
  sheet,
  bundleRecords,
  redditPostUrl,
  onClose,
  announce,
}: {
  sheet: BuySheet | null;
  bundleRecords: DbRecord[];
  redditPostUrl: string;
  onClose: (sentBundle: boolean) => void;
  announce: (message: string) => void;
}) {
  // Optional Reddit handle typed on the buy sheet; saved with the request so
  // the admin doesn't have to retype it from the DM. In email mode the same
  // field is the buyer's name.
  const [buyerName, setBuyerName] = useState("");
  // How the buyer wants to send the request. Email is the default — no
  // account needed anywhere; the Reddit DM stays for r/VinylCollectors.
  const [requestMode, setRequestMode] = useState<RequestMode>("email");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [buyerNote, setBuyerNote] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [emailStatus, setEmailStatus] = useState<EmailStatus>({ kind: "idle" });
  const [commentCopied, setCommentCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);

  const items = sheet?.kind === "single" ? [sheet.record] : bundleRecords;
  const ref = useModal(!!sheet && items.length > 0);
  const quote = bundleBreakdown(items);
  const hasPost = Boolean(redditPostUrl);

  function close() {
    const sentBundle = emailStatus.kind === "sent" && sheet?.kind === "bundle";
    if (emailStatus.kind !== "sending") setEmailStatus({ kind: "idle" });
    onClose(sentBundle);
  }

  // A bundle sheet with nothing left in it has nothing to sell.
  useEffect(() => {
    if (sheet?.kind === "bundle" && bundleRecords.length === 0) onClose(false);
  }, [sheet, bundleRecords, onClose]);

  // Save the request (single record or bundle) and open the pre-filled DM.
  async function sendRequest(list: DbRecord[]) {
    for (const r of list) track(r.id, "buy_request");
    const refCode = makeRefCode();
    const { subject, message } =
      list.length === 1
        ? singleRequestMessage(list[0], hasPost, refCode)
        : combinedRequestMessage(list, hasPost, refCode);
    // Insert before window.open but without awaiting — popup blockers only
    // tolerate window.open inside the click gesture.
    persistOrderRequest(
      refCode,
      list.map((r) => r.id),
      buyerName
    );
    const url = composeUrl(subject, message);
    if (url.length <= 2000) {
      window.open(url, "_blank", "noopener");
      return;
    }
    // Compose URLs past ~2k chars get truncated — copy the body instead and
    // open the compose window with just the subject.
    try {
      await navigator.clipboard.writeText(message);
      setMessageCopied(true);
      announce("Message copied — paste it into the Reddit DM.");
      setTimeout(() => setMessageCopied(false), 2500);
    } catch {
      window.prompt("Copy this message, then paste it into the DM:", message);
    }
    window.open(composeUrl(subject), "_blank", "noopener");
  }

  // Email path: the server saves the request (same table and ref code as
  // the DM path), emails the admin, and sends the buyer a confirmation.
  async function sendEmailRequest(list: DbRecord[]) {
    const email = buyerEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailStatus({ kind: "error", message: "Enter a valid email address so I can reply." });
      return;
    }
    setEmailStatus({ kind: "sending" });
    for (const r of list) track(r.id, "buy_request");
    try {
      const res = await fetch("/api/order-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_ids: list.map((r) => r.id),
          buyer_name: buyerName.trim() || undefined,
          buyer_email: email,
          message: buyerNote.trim() || undefined,
          website: honeypot,
        }),
      });
      if (res.status === 204) {
        // Honeypot tripped — pretend it worked, nothing was saved.
        setEmailStatus({ kind: "sent", refCode: makeRefCode(), email });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { refCode?: string; error?: string };
      if (!res.ok || !body.refCode) {
        setEmailStatus({
          kind: "error",
          message: body.error || "Couldn't send the request right now.",
        });
        return;
      }
      setEmailStatus({ kind: "sent", refCode: body.refCode, email });
      announce(`Request sent, reference ${body.refCode}.`);
    } catch {
      setEmailStatus({ kind: "error", message: "Couldn't reach the shop — check your connection." });
    }
  }

  async function copyCommentAndOpenPost() {
    const titles = items.map((r) => `${r.artist} — ${r.title}`);
    const comment =
      items.length === 1
        ? `Sent you a DM about ${titles[0]}!`
        : `Sent you a DM about ${items.length} records: ${titles.slice(0, 3).join("; ")}${
            titles.length > 3 ? ` and ${titles.length - 3} more` : ""
          }!`;
    try {
      await navigator.clipboard.writeText(comment);
      setCommentCopied(true);
      announce("Comment copied to clipboard.");
      setTimeout(() => setCommentCopied(false), 2500);
    } catch {
      window.prompt("Copy this comment, then paste it on the post:", comment);
    }
    window.open(redditPostUrl, "_blank", "noopener");
  }

  return (
    <dialog
      ref={ref}
      className="shop-dialog"
      aria-label="Request to buy"
      onClose={close}
      onClick={(e) => onBackdropClick(e, close)}
    >
      {sheet && items.length > 0 ? (
        <div className="shop-dialog-body">
          <div className="shop-dialog-head">
            <h3>Request to buy</h3>
            <button
              type="button"
              className="shop-dialog-close"
              aria-label="Close"
              onClick={close}
            >
              ×
            </button>
          </div>
          <ul className="shop-dialog-items">
            {items.map((r) => (
              <li key={r.id}>
                <span>
                  {r.artist} — {r.title}
                </span>
                <span>${r.price}</span>
              </li>
            ))}
          </ul>
          <div className="shop-dialog-total">
            <span>
              ${quote.subtotal}
              {quote.shipping > 0
                ? ` + $${quote.shipping} shipping`
                : " + free shipping"}
            </span>
            <strong>= ${quote.total}</strong>
          </div>
          {emailStatus.kind === "sent" ? (
            <div className="shop-dialog-success" role="status">
              <strong>Request sent — ref {emailStatus.refCode}</strong>
              <p>
                A confirmation is on its way to {emailStatus.email}. I&rsquo;ll
                reply from {SELLER_INFO.contactEmail}, usually within a day,
                with a PayPal invoice once we&rsquo;ve confirmed what&rsquo;s
                available.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={close}
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div
                className="shop-dialog-tabs"
                role="tablist"
                aria-label="How to send the request"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={requestMode === "email"}
                  className={requestMode === "email" ? "is-active" : ""}
                  onClick={() => setRequestMode("email")}
                >
                  Email
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={requestMode === "reddit"}
                  className={requestMode === "reddit" ? "is-active" : ""}
                  onClick={() => setRequestMode("reddit")}
                >
                  Reddit DM
                </button>
              </div>
              {requestMode === "email" ? (
                <form
                  className="shop-dialog-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (emailStatus.kind !== "sending") sendEmailRequest(items);
                  }}
                >
                  <p className="shop-dialog-hint">
                    No account needed. I&rsquo;ll email you back to confirm
                    what&rsquo;s available, then send a PayPal invoice.
                  </p>
                  <label className="shop-dialog-field">
                    <span>Your name (optional)</span>
                    <input
                      type="text"
                      className="input"
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      maxLength={80}
                      autoComplete="name"
                    />
                  </label>
                  <label className="shop-dialog-field">
                    <span>Your email</span>
                    <input
                      type="email"
                      className="input"
                      value={buyerEmail}
                      onChange={(e) => setBuyerEmail(e.target.value)}
                      placeholder="so I can reply"
                      maxLength={254}
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label className="shop-dialog-field">
                    <span>Anything else? (optional)</span>
                    <textarea
                      className="input"
                      value={buyerNote}
                      onChange={(e) => setBuyerNote(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      placeholder="questions, a hold request, photos of this copy…"
                    />
                  </label>
                  {/* Honeypot: hidden from people, filled in by bots. */}
                  <div className="shop-honeypot" aria-hidden="true">
                    <label>
                      Website
                      <input
                        type="text"
                        name="website"
                        tabIndex={-1}
                        autoComplete="off"
                        value={honeypot}
                        onChange={(e) => setHoneypot(e.target.value)}
                      />
                    </label>
                  </div>
                  {emailStatus.kind === "error" ? (
                    <p className="shop-dialog-error" role="alert">
                      {emailStatus.message.replace(/[.!?]?$/, ".")}{" "}
                      <a href={mailtoFallback(items)}>
                        Email the list instead ↗
                      </a>
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    className="btn btn-primary btn-block"
                    disabled={emailStatus.kind === "sending"}
                  >
                    {emailStatus.kind === "sending" ? "Sending…" : "Send request"}
                  </button>
                </form>
              ) : (
                <>
                  <p className="shop-dialog-hint">
                    {hasPost
                      ? "Two quick steps, per subreddit rules: open the pre-filled Reddit DM (edit anything before sending), then paste the copied comment on the sale post."
                      : "This opens a pre-filled Reddit DM — edit anything before sending."}{" "}
                    Everything happens on Reddit; no account needed here.
                  </p>
                  <label className="shop-dialog-field">
                    <span>Your Reddit username (optional)</span>
                    <span className="shop-dialog-field-input">
                      <span aria-hidden="true">u/</span>
                      <input
                        type="text"
                        className="input"
                        value={buyerName}
                        onChange={(e) => setBuyerName(e.target.value)}
                        placeholder="so I know who to reply to"
                        maxLength={24}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </span>
                  </label>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() => sendRequest(items)}
                  >
                    {messageCopied
                      ? "Message copied — paste into the DM"
                      : hasPost
                        ? "1. Open the pre-filled DM ↗"
                        : "Open the pre-filled DM ↗"}
                  </button>
                  {hasPost ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-block"
                      onClick={copyCommentAndOpenPost}
                    >
                      {commentCopied
                        ? "Comment copied!"
                        : "2. Copy comment & open the post"}
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      ) : null}
    </dialog>
  );
}

// ── Photo lightbox ───────────────────────────────────────────────────────

export type LightboxState = { record: DbRecord; index: number };

export function PhotoLightbox({
  state,
  onChange,
}: {
  state: LightboxState | null;
  onChange: (next: LightboxState | null) => void;
}) {
  const ref = useModal(!!state);
  const touchX = useRef<number | null>(null);
  const photos = state?.record.photo_urls ?? [];

  function step(delta: number) {
    if (!state || photos.length < 2) return;
    onChange({ ...state, index: (state.index + delta + photos.length) % photos.length });
  }

  const src = state ? photos[state.index] : undefined;
  return (
    <dialog
      ref={ref}
      className="shop-lightbox"
      aria-label="Record photos"
      onClose={() => onChange(null)}
      onClick={(e) => onBackdropClick(e, () => onChange(null))}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      {state && src ? (
        <div
          className="shop-lightbox-body"
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touchX.current;
            touchX.current = null;
            if (start == null) return;
            const dx = (e.changedTouches[0]?.clientX ?? start) - start;
            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
          }}
        >
          <div className="shop-lightbox-top">
            <span className="shop-lightbox-title">
              {state.record.artist} — {state.record.title}
            </span>
            <span className="shop-lightbox-count">
              {state.index + 1} / {photos.length}
            </span>
            <button
              type="button"
              className="shop-dialog-close"
              aria-label="Close photos"
              onClick={() => onChange(null)}
            >
              ×
            </button>
          </div>
          <div className="shop-lightbox-stage">
            {photos.length > 1 ? (
              <button
                type="button"
                className="shop-lightbox-nav"
                aria-label="Previous photo"
                onClick={() => step(-1)}
              >
                ‹
              </button>
            ) : null}
            <Image
              key={src}
              src={src}
              alt={`${state.record.artist} — ${state.record.title}, photo ${state.index + 1} of ${photos.length}`}
              width={1200}
              height={1200}
              sizes="100vw"
              className="shop-lightbox-img"
            />
            {photos.length > 1 ? (
              <button
                type="button"
                className="shop-lightbox-nav"
                aria-label="Next photo"
                onClick={() => step(1)}
              >
                ›
              </button>
            ) : null}
          </div>
          {photos.length > 1 ? (
            <div className="shop-lightbox-thumbs">
              {photos.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  className={i === state.index ? "is-active" : ""}
                  aria-label={`Photo ${i + 1}`}
                  onClick={() => onChange({ ...state, index: i })}
                >
                  <Image src={u} alt="" width={80} height={80} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
