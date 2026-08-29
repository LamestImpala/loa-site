"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  LETTERS,
  RECORDS_PER_PARCEL,
  SELLER_INFO,
  artistLetter,
  bundleBreakdown,
  combinedShipping,
  makeRefCode,
} from "@/lib/records";
import { getBrowserSupabase, type DbRecord } from "@/lib/supabase";

type SortOption = "artist" | "price-asc" | "price-desc" | "discount" | "newest";
type AvailOption = "all" | "open" | "sold";
// Grid density: full cards or a compact covers grid. `null` = auto, which
// resolves to compact on phones once the viewport is known.
type ViewOption = "full" | "compact";

const SORT_OPTIONS: SortOption[] = [
  "artist",
  "price-asc",
  "price-desc",
  "discount",
  "newest",
];
const AVAIL_OPTIONS: AvailOption[] = ["all", "open", "sold"];

const NEW_WINDOW_DAYS = 14;
// Was-prices and discount badges clear from view a day after the change.
const REDUCED_WINDOW_HOURS = 24;

function isNew(r: DbRecord) {
  return (
    !!r.created_at &&
    Date.now() - new Date(r.created_at).getTime() <
      NEW_WINDOW_DAYS * 24 * 3600 * 1000
  );
}

// Reduced = price dropped and the change is recent enough to still matter.
function isReduced(r: DbRecord) {
  return (
    r.prev_price != null &&
    Number(r.prev_price) > r.price &&
    Date.now() - new Date(r.updated_at).getTime() <
      REDUCED_WINDOW_HOURS * 3600 * 1000
  );
}

function isOnHold(r: DbRecord) {
  return !!r.hold_until && new Date(r.hold_until).getTime() > Date.now();
}

type TrackEvent = "photo_open" | "discogs_click" | "bundle_add" | "buy_request";
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

function track(recordId: number, event: TrackEvent) {
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

function dropPct(r: DbRecord) {
  return Math.round((1 - r.price / Number(r.prev_price)) * 100);
}

function initials(artist: string) {
  return artist
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// Deterministic accent tint per artist so placeholder covers vary like the mockup.
const TINTS = [
  { bg: "var(--color-accent-200)", text: "var(--color-accent-800)" },
  { bg: "var(--color-accent-2-200)", text: "var(--color-accent-2-800)" },
  { bg: "var(--color-neutral-200)", text: "var(--color-neutral-800)" },
  { bg: "var(--color-accent-300)", text: "var(--color-accent-900)" },
  { bg: "var(--color-accent-2-300)", text: "var(--color-accent-2-900)" },
  { bg: "var(--color-neutral-300)", text: "var(--color-neutral-900)" },
];

function tintFor(artist: string) {
  let h = 0;
  for (const ch of artist) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return TINTS[h % TINTS.length];
}

function discogsUrl(r: DbRecord) {
  return r.discogs_release_id
    ? `https://www.discogs.com/release/${r.discogs_release_id}`
    : `https://www.discogs.com/search/?q=${encodeURIComponent(`${r.artist} ${r.title}`)}&type=release`;
}

function requestToBuyUrl(r: DbRecord, hasPost: boolean) {
  const subject = `Record purchase: ${r.artist} — ${r.title}`;
  const commentLine = hasPost
    ? "\nI'll also comment on your Reddit post to confirm I sent this DM.\n"
    : "";
  const shipping = combinedShipping(1);
  const message = `Hi! I am interested in purchasing this title from you:\n\n${r.artist} — ${r.title}\n${r.pressing}\nMedia: ${r.media} / Sleeve: ${r.sleeve} — $${r.price}\n$${r.price} + $${shipping} shipping = $${r.price + shipping} total\n${commentLine}\n(Found on https://curiouserrecords.com)\n\n`;
  return `https://www.reddit.com/message/compose/?to=${SELLER_INFO.redditUsername}&subject=${encodeURIComponent(subject)}&message=${encodeURIComponent(message)}`;
}

// One combined DM for a bundle of records; parallels requestToBuyUrl but drops
// the pressing line per record to keep the compose URL short. The Ref line
// ties the DM to the order_requests row saved when the buyer clicks send.
function combinedRequestMessage(
  list: DbRecord[],
  hasPost: boolean,
  refCode: string
) {
  const subject = `Record purchase: ${list.length} records from your list`;
  const { lines, subtotal, parcels, shipping, total } = bundleBreakdown(list);
  const commentLine = hasPost
    ? "\nI'll also comment on your Reddit post to confirm I sent this DM.\n"
    : "";
  const message = `Hi! I am interested in purchasing these titles from you:\n\n${lines.join(
    "\n"
  )}\n\nSubtotal: $${subtotal}\nShipping (${parcels} parcel${parcels === 1 ? "" : "s"} of up to ${RECORDS_PER_PARCEL} records): $${shipping}\nTotal: $${total}\nRef: ${refCode}\n${commentLine}\n(Found on https://curiouserrecords.com)\n\n`;
  return { subject, message };
}

function combinedRequestUrl(list: DbRecord[], hasPost: boolean, refCode: string) {
  const { subject, message } = combinedRequestMessage(list, hasPost, refCode);
  return `https://www.reddit.com/message/compose/?to=${SELLER_INFO.redditUsername}&subject=${encodeURIComponent(subject)}&message=${encodeURIComponent(message)}`;
}

// Fire-and-forget: save the request so /admin can load it by ref code. The
// trigger revalidates ids and recomputes totals server-side; errors are
// swallowed because the DM must go out regardless (paste parser is the
// fallback). No .select() — the anon role has no read access to the table.
function persistOrderRequest(refCode: string, ids: number[]) {
  getBrowserSupabase()
    .from("order_requests")
    .insert({ ref_code: refCode, record_ids: ids })
    .then(({ error }) => {
      if (error) console.warn("order request not saved:", error.message);
    });
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// What the buyer is asking to purchase: one record from a card, or the bundle.
type BuySheet = { kind: "single"; record: DbRecord } | { kind: "bundle" };
type LightboxState = { record: DbRecord; index: number };

export default function RecordsClient({
  records,
  redditPostUrl,
}: {
  records: DbRecord[];
  redditPostUrl: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("artist");
  const [avail, setAvail] = useState<AvailOption>("all");
  const [genre, setGenre] = useState<string>("all");
  const [collection, setCollection] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const [commentCopiedId, setCommentCopiedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [combinedCommentCopied, setCombinedCommentCopied] = useState(false);
  const [combinedMessageCopied, setCombinedMessageCopied] = useState(false);
  const [buySheet, setBuySheet] = useState<BuySheet | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [detail, setDetail] = useState<DbRecord | null>(null);
  const [view, setView] = useState<ViewOption | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  const controlsRef = useRef<HTMLElement | null>(null);
  const buyDialogRef = useRef<HTMLDialogElement | null>(null);
  const lightboxRef = useRef<HTMLDialogElement | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const urlSynced = useRef(false);
  const touchX = useRef<number | null>(null);

  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setSort("artist");
    setAvail("all");
    setGenre("all");
    setCollection(null);
    setLetter(null);
  }

  function announce(message: string) {
    setLiveMessage(message);
  }

  async function copyCommentAndOpenPost(r: DbRecord) {
    const comment = `Sent you a DM about ${r.artist} — ${r.title}!`;
    try {
      await navigator.clipboard.writeText(comment);
      setCommentCopiedId(r.id);
      announce("Comment copied to clipboard.");
      setTimeout(() => setCommentCopiedId(null), 2500);
    } catch {
      window.prompt("Copy this comment, then paste it on the post:", comment);
    }
    window.open(redditPostUrl, "_blank", "noopener");
  }

  // Derived from `records` (not `visible`) so filters never drop a selection,
  // and records that sell or go on hold fall out of the bundle automatically.
  const selectedRecords = useMemo(
    () => records.filter((r) => selected.has(r.id) && !r.sold && !isOnHold(r)),
    [records, selected]
  );
  const bundleSubtotal = selectedRecords.reduce((s, r) => s + r.price, 0);
  const bundleShipping = combinedShipping(selectedRecords.length);

  async function sendCombinedRequest() {
    for (const r of selectedRecords) track(r.id, "buy_request");
    const hasPost = Boolean(redditPostUrl);
    const refCode = makeRefCode();
    const url = combinedRequestUrl(selectedRecords, hasPost, refCode);
    // Insert before window.open but without awaiting — popup blockers only
    // tolerate window.open inside the click gesture.
    persistOrderRequest(
      refCode,
      selectedRecords.map((r) => r.id)
    );
    if (url.length <= 2000) {
      window.open(url, "_blank", "noopener");
      return;
    }
    // Compose URLs past ~2k chars get truncated — copy the body instead and
    // open the compose window with just the subject.
    const { subject, message } = combinedRequestMessage(
      selectedRecords,
      hasPost,
      refCode
    );
    try {
      await navigator.clipboard.writeText(message);
      setCombinedMessageCopied(true);
      announce("Message copied — paste it into the Reddit DM.");
      setTimeout(() => setCombinedMessageCopied(false), 2500);
    } catch {
      window.prompt("Copy this message, then paste it into the DM:", message);
    }
    window.open(
      `https://www.reddit.com/message/compose/?to=${SELLER_INFO.redditUsername}&subject=${encodeURIComponent(subject)}`,
      "_blank",
      "noopener"
    );
  }

  async function copyCombinedCommentAndOpenPost() {
    const titles = selectedRecords.map((r) => `${r.artist} — ${r.title}`);
    const shown = titles.slice(0, 3).join("; ");
    const rest = titles.length - 3;
    const comment = `Sent you a DM about ${selectedRecords.length} records: ${shown}${rest > 0 ? ` and ${rest} more` : ""}!`;
    try {
      await navigator.clipboard.writeText(comment);
      setCombinedCommentCopied(true);
      announce("Comment copied to clipboard.");
      setTimeout(() => setCombinedCommentCopied(false), 2500);
    } catch {
      window.prompt("Copy this comment, then paste it on the post:", comment);
    }
    window.open(redditPostUrl, "_blank", "noopener");
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = records.filter((r) => {
      if (avail === "open" && r.sold) return false;
      if (avail === "sold" && !r.sold) return false;
      if (genre !== "all" && !(r.genres ?? []).includes(genre)) return false;
      if (collection && r.collection !== collection) return false;
      if (letter && artistLetter(r.artist) !== letter) return false;
      if (!q) return true;
      return `${r.artist} ${r.title} ${r.pressing}`.toLowerCase().includes(q);
    });
    list.sort((a, b) =>
      sort === "price-asc"
        ? a.price - b.price
        : sort === "price-desc"
          ? b.price - a.price
          : sort === "discount"
            ? (isReduced(b) ? dropPct(b) : 0) - (isReduced(a) ? dropPct(a) : 0)
            : sort === "newest"
              ? new Date(b.created_at ?? 0).getTime() -
                new Date(a.created_at ?? 0).getTime()
              : (a.artist + a.title).localeCompare(b.artist + b.title)
    );
    return list;
  }, [records, query, sort, avail, genre, collection, letter]);

  const drops = useMemo(
    () => records.filter((r) => isReduced(r) && !r.sold),
    [records]
  );

  const genres = useMemo(
    () =>
      [...new Set(records.flatMap((r) => r.genres ?? []))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [records]
  );

  const collections = useMemo(
    () =>
      [...new Set(records.map((r) => r.collection).filter(Boolean))].sort() as string[],
    [records]
  );

  const activeLetters = useMemo(
    () => new Set(records.map((r) => artistLetter(r.artist))),
    [records]
  );

  const available = records.filter((r) => !r.sold).length;
  const hasFilters =
    query.trim() !== "" ||
    avail !== "all" ||
    genre !== "all" ||
    collection !== null ||
    letter !== null;

  // Explicit choice wins; auto = compact on phones, full cards on desktop.
  const effectiveView: ViewOption = view ?? (isMobile ? "compact" : "full");

  function chooseView(v: ViewOption) {
    setView(v);
    try {
      localStorage.setItem("cr_view", v);
    } catch {
      // The toggle still works for this visit.
    }
  }

  // "178 records" when nothing narrows the list; the fuller breakdown only
  // when it would differ.
  const countLabel = hasFilters
    ? `${visible.length} of ${records.length} records`
    : available === records.length
      ? `${records.length} records`
      : `${available} available of ${records.length} records`;

  function scrollToRecord(id: number) {
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    const go = () => {
      const el = document.getElementById(`r-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior, block: "center" });
      setHighlightId(id);
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(
        () => setHighlightId(null),
        2400
      );
    };
    if (document.getElementById(`r-${id}`)) {
      go();
    } else {
      // The card is filtered out — reset filters, then jump after re-render.
      clearFilters();
      window.setTimeout(go, 80);
    }
  }

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  // ── URL state: read once on mount (?q=&sort=&genre=&avail=&coll=&letter=
  // plus #r-<id> deep links) …
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuery(q);
    const s = params.get("sort") as SortOption | null;
    if (s && SORT_OPTIONS.includes(s)) setSort(s);
    const a = params.get("avail") as AvailOption | null;
    if (a && AVAIL_OPTIONS.includes(a)) setAvail(a);
    const g = params.get("genre");
    if (g) setGenre(g);
    const c = params.get("coll");
    if (c) setCollection(c);
    const l = params.get("letter");
    if (l && LETTERS.includes(l)) setLetter(l);
    const m = window.location.hash.match(/^#r-(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      window.setTimeout(() => scrollToRecord(id), 120);
    }
    urlSynced.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // … and write back (debounced — Safari rate-limits replaceState).
  useEffect(() => {
    if (!urlSynced.current) return;
    const t = window.setTimeout(() => {
      const p = new URLSearchParams();
      if (query.trim()) p.set("q", query.trim());
      if (sort !== "artist") p.set("sort", sort);
      if (genre !== "all") p.set("genre", genre);
      if (avail !== "all") p.set("avail", avail);
      if (collection) p.set("coll", collection);
      if (letter) p.set("letter", letter);
      const qs = p.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
      );
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, sort, genre, avail, collection, letter]);

  // Stored view choice wins; otherwise the matchMedia effect below decides.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("cr_view");
      if (stored === "full" || stored === "compact") setView(stored);
    } catch {
      // Private mode etc. — fall back to auto.
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Condensed sticky bar once the full controls scroll out of view.
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) =>
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Native <dialog> drives focus trapping and Esc for the buy sheet…
  useEffect(() => {
    const d = buyDialogRef.current;
    if (!d) return;
    if (buySheet && !d.open) d.showModal();
    else if (!buySheet && d.open) d.close();
  }, [buySheet]);

  // …and the photo lightbox.
  useEffect(() => {
    const d = lightboxRef.current;
    if (!d) return;
    if (lightbox && !d.open) d.showModal();
    else if (!lightbox && d.open) d.close();
  }, [lightbox]);

  // …and the compact-view record detail popup.
  useEffect(() => {
    const d = detailDialogRef.current;
    if (!d) return;
    if (detail && !d.open) d.showModal();
    else if (!detail && d.open) d.close();
  }, [detail]);

  // A bundle sheet with nothing left in it has nothing to sell.
  useEffect(() => {
    if (buySheet?.kind === "bundle" && selectedRecords.length === 0) {
      setBuySheet(null);
    }
  }, [buySheet, selectedRecords]);

  function openLightbox(r: DbRecord, index: number) {
    track(r.id, "photo_open");
    setLightbox({ record: r, index });
  }

  function stepLightbox(delta: number) {
    setLightbox((l) => {
      if (!l) return l;
      const photos = l.record.photo_urls ?? [];
      if (photos.length < 2) return l;
      return { ...l, index: (l.index + delta + photos.length) % photos.length };
    });
  }

  function onBackdropClick(
    e: React.MouseEvent<HTMLDialogElement>,
    close: () => void
  ) {
    if (e.target === e.currentTarget) close();
  }

  // Tags, notes, price row, and buy actions — shared between the full record
  // card and the compact view's detail popup.
  function recordDetails(r: DbRecord) {
    const held = isOnHold(r) && !r.sold;
    const reduced = isReduced(r) && !r.sold;
    return (
      <>
        <div className="record-tags">
          <span className="tag tag-outline">Media: {r.media}</span>
          <span className="tag tag-outline">Sleeve: {r.sleeve}</span>
          {r.photo_urls?.length ? (
            <span className="tag tag-neutral">Actual copy pictured</span>
          ) : null}
          {reduced ? (
            <span className="tag tag-accent-2">Drink me · ↓ {dropPct(r)}%</span>
          ) : null}
        </div>

        {r.notes ? <p className="record-notes">{r.notes}</p> : null}

        <div className="record-price-row">
          {reduced ? (
            <span className="record-prev-price">${r.prev_price}</span>
          ) : null}
          <span className="record-price">${r.price}</span>
          <a
            href={discogsUrl(r)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track(r.id, "discogs_click")}
          >
            Discogs ↗
          </a>
        </div>

        {r.sold ? (
          <button className="btn btn-secondary btn-block" disabled>
            Sold — gone down the rabbit hole
          </button>
        ) : held ? (
          <p className="record-hold-note">
            On hold — the White Rabbit&rsquo;s watch is ticking. Check back in
            case it falls through.
          </p>
        ) : SELLER_INFO.redditUsername ? (
          <>
            <button
              type="button"
              className={`record-select ${selected.has(r.id) ? "is-selected" : ""}`}
              aria-pressed={selected.has(r.id)}
              onClick={() => {
                if (!selected.has(r.id)) track(r.id, "bundle_add");
                toggleSelected(r.id);
              }}
            >
              {selected.has(r.id) ? "✓ In your bundle" : "+ Add to bundle"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                setDetail(null);
                setBuySheet({ kind: "single", record: r });
              }}
            >
              Request to buy
            </button>
          </>
        ) : null}
      </>
    );
  }

  function recordCard(r: DbRecord) {
    const cover = r.photo_urls?.[0] || r.cover_image;
    const held = isOnHold(r) && !r.sold;
    const reduced = isReduced(r) && !r.sold;
    const tint = tintFor(r.artist);
    if (effectiveView === "compact") {
      return (
        <button
          key={r.id}
          id={`r-${r.id}`}
          type="button"
          className={`card elev-sm record-compact ${r.sold ? "is-sold" : ""} ${
            selected.has(r.id) && !r.sold && !held ? "is-selected" : ""
          } ${highlightId === r.id ? "is-highlighted" : ""}`}
          aria-label={`${r.artist} — ${r.title}, $${r.price}${
            r.sold ? ", sold" : held ? ", on hold" : ""
          }`}
          onClick={() => setDetail(r)}
        >
          <span
            className="record-compact-cover"
            style={cover ? undefined : { background: tint.bg }}
          >
            {cover ? (
              <Image
                src={cover}
                alt=""
                width={300}
                height={300}
                sizes="(min-width: 640px) 160px, 33vw"
              />
            ) : (
              <span className="initials" style={{ color: tint.text }}>
                {initials(r.artist)}
              </span>
            )}
            {r.sold ? (
              <span
                className="tag record-mini-badge"
                style={{
                  background: "var(--color-neutral-800)",
                  color: "var(--color-neutral-100)",
                }}
              >
                SOLD
              </span>
            ) : held ? (
              <span className="tag tag-accent record-mini-badge">HOLD</span>
            ) : reduced ? (
              <span className="tag tag-accent-2 record-mini-badge">
                ↓ {dropPct(r)}%
              </span>
            ) : null}
          </span>
          <span className="record-compact-title">
            {r.artist} — {r.title}
          </span>
          <span className="record-compact-price">${r.price}</span>
        </button>
      );
    }
    return (
      <article
        key={r.id}
        id={`r-${r.id}`}
        className={`card elev-sm record-card ${r.sold ? "is-sold" : ""} ${
          selected.has(r.id) && !r.sold && !held ? "is-selected" : ""
        } ${highlightId === r.id ? "is-highlighted" : ""}`}
      >
        <div className="record-cover-wrap">
          <div
            className="record-cover"
            style={cover ? undefined : { background: tint.bg }}
          >
            {cover ? (
              r.photo_urls?.length ? (
                <button
                  type="button"
                  className="record-cover-btn"
                  onClick={() => openLightbox(r, 0)}
                  aria-label={`View photos of ${r.artist} — ${r.title}`}
                >
                  <Image
                    src={cover}
                    alt={`${r.artist} — ${r.title}`}
                    width={600}
                    height={600}
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
                  />
                </button>
              ) : (
                <Image
                  src={cover}
                  alt={`${r.artist} — ${r.title}`}
                  width={600}
                  height={600}
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
                />
              )
            ) : (
              <span className="initials" style={{ color: tint.text }}>
                {initials(r.artist)}
              </span>
            )}
          </div>
          {r.sold ? (
            <span
              className="tag record-badge-tl"
              style={{
                background: "var(--color-neutral-800)",
                color: "var(--color-neutral-100)",
              }}
            >
              SOLD
            </span>
          ) : held ? (
            <span className="tag tag-accent record-badge-tl">ON HOLD</span>
          ) : null}
          {isNew(r) && !r.sold ? (
            <span className="tag tag-accent record-badge-tr">New arrival</span>
          ) : null}
        </div>

        {r.photo_urls?.length > 1 ? (
          <div className="record-thumbs">
            {r.photo_urls.slice(1, 5).map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => openLightbox(r, i + 1)}
                aria-label={`View photo ${i + 2} of ${r.artist} — ${r.title}`}
              >
                <Image
                  src={url}
                  alt=""
                  width={150}
                  height={150}
                  sizes="(min-width: 640px) 90px, 25vw"
                />
              </button>
            ))}
          </div>
        ) : null}

        <div>
          <div className="record-title">
            {r.artist} — {r.title}
          </div>
          <div className="record-meta">
            {r.pressing}
            {r.collection ? ` · ${r.collection}` : ""}
          </div>
        </div>

        {recordDetails(r)}
      </article>
    );
  }

  // Rendered in the controls row and again in the sticky bar.
  function viewToggle() {
    return (
      <div className="seg" role="group" aria-label="View density">
        {(
          [
            ["full", "Cards"],
            ["compact", "Covers"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="seg-opt"
            aria-pressed={effectiveView === value}
            onClick={() => chooseView(value)}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }

  // The buy sheet quotes one card's record or the whole bundle with the same
  // math the DM itself uses.
  const sheetItems =
    buySheet?.kind === "single" ? [buySheet.record] : selectedRecords;
  const sheetQuote = bundleBreakdown(sheetItems);
  const hasPost = Boolean(redditPostUrl);

  return (
    <>
      {drops.length > 0 ? (
        <section className="shop-shell shop-section">
          <div className="shop-section-head">
            <h2>Drink me — today&rsquo;s shrinking prices</h2>
            <span className="shop-muted">vs. yesterday&rsquo;s Discogs price</span>
          </div>
          <div className="shop-drops">
            {drops.map((r) => {
              const tint = tintFor(r.artist);
              const cover = r.photo_urls?.[0] || r.cover_image;
              return (
                <button
                  key={r.id}
                  type="button"
                  className="shop-drop-chip"
                  onClick={() => scrollToRecord(r.id)}
                >
                  <span
                    className="thumb"
                    style={cover ? undefined : { background: tint.bg }}
                  >
                    {cover ? (
                      <Image
                        src={cover}
                        alt=""
                        width={68}
                        height={68}
                      />
                    ) : (
                      initials(r.artist)
                    )}
                  </span>
                  <span className="name">
                    {r.artist} — {r.title}
                  </span>
                  <span className="tag tag-accent-2">↓ {dropPct(r)}%</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section
        id="records"
        ref={controlsRef}
        className="shop-shell shop-section shop-controls"
      >
        <div className="shop-controls-row">
          <input
            type="search"
            className="input search"
            aria-label="Search records"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you curious about? Artist, title, label…"
          />
          <select
            className="input"
            aria-label="Sort records"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            style={{ width: "auto" }}
          >
            <option value="artist">Sort: Artist A–Z</option>
            <option value="price-asc">Price: low → high</option>
            <option value="price-desc">Price: high → low</option>
            <option value="discount">Biggest discount</option>
            <option value="newest">Newest arrivals</option>
          </select>
          {genres.length > 0 ? (
            <select
              className="input"
              aria-label="Filter by genre"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              style={{ width: "auto" }}
            >
              <option value="all">Genre: All</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          ) : null}
          <div className="seg" role="group" aria-label="Availability">
            {(
              [
                ["all", "All"],
                ["open", "Available"],
                ["sold", "Sold"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="seg-opt"
                aria-pressed={avail === value}
                onClick={() => setAvail(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {viewToggle()}
        </div>

        {collections.length > 0 ? (
          <div className="shop-chip-row" role="group" aria-label="Collections">
            <span className="shop-muted">Collections:</span>
            <button
              type="button"
              className={collection === null ? "tag tag-accent" : "tag tag-outline"}
              onClick={() => setCollection(null)}
            >
              All
            </button>
            {collections.map((c) => (
              <button
                key={c}
                type="button"
                className={collection === c ? "tag tag-accent" : "tag tag-outline"}
                onClick={() => setCollection(collection === c ? null : c)}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}

        <div className="shop-letter-row">
          <div
            className="shop-letters"
            role="group"
            aria-label="Browse by artist letter"
          >
            <button
              type="button"
              className="shop-letter"
              aria-pressed={letter === null}
              onClick={() => setLetter(null)}
            >
              All
            </button>
            {LETTERS.map((l) => (
              <button
                key={l}
                type="button"
                className="shop-letter"
                aria-pressed={letter === l}
                disabled={!activeLetters.has(l)}
                onClick={() => setLetter(letter === l ? null : l)}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="shop-muted">{countLabel}</span>
          {hasFilters ? (
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        <p className="shop-controls-note">
          Records are claimed by Reddit DM — no account needed on this site.
          Bundle up: shipping is $6 per parcel of up to {RECORDS_PER_PARCEL}{" "}
          records.
        </p>
      </section>

      {stuck ? (
        <div className="shop-sticky-bar">
          <div className="shop-shell shop-sticky-inner">
            <input
              type="search"
              className="input search"
              aria-label="Search records"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search records…"
            />
            <select
              className="input shop-sticky-sort"
              aria-label="Sort records"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
            >
              <option value="artist">Sort: Artist A–Z</option>
              <option value="price-asc">Price: low → high</option>
              <option value="price-desc">Price: high → low</option>
              <option value="discount">Biggest discount</option>
              <option value="newest">Newest arrivals</option>
            </select>
            <span className="shop-muted shop-sticky-count">{countLabel}</span>
            {viewToggle()}
            <button type="button" className="btn btn-ghost" onClick={scrollToTop}>
              ↑ Top
            </button>
          </div>
        </div>
      ) : null}

      <div className="shop-shell shop-main">
        {visible.length > 0 ? (
          <div
            className={`shop-grid view-${effectiveView} ${stuck ? "has-sticky-bar" : ""}`}
          >
            {sort === "artist"
              ? // Letter separators only make sense alphabetically; they stick
                // below the condensed bar so the current letter stays visible.
                visible.flatMap((r, i) => {
                  const l = artistLetter(r.artist);
                  const prev =
                    i > 0 ? artistLetter(visible[i - 1].artist) : null;
                  const nodes =
                    l !== prev
                      ? [
                          <h3 key={`sep-${l}`} className="shop-letter-sep">
                            {l}
                          </h3>,
                        ]
                      : [];
                  nodes.push(recordCard(r));
                  return nodes;
                })
              : visible.map(recordCard)}
          </div>
        ) : (
          <div className="card shop-empty">
            <div className="shop-empty-title">
              Curiouser and curiouser… nothing matches.
            </div>
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      {selectedRecords.length > 0 ? (
        <div className="shop-bundle-bar" role="region" aria-label="Your bundle">
          <div className="shop-shell shop-bundle-inner">
            <span className="shop-bundle-summary" aria-live="polite">
              {selectedRecords.length} record
              {selectedRecords.length === 1 ? "" : "s"} · ${bundleSubtotal} + $
              {bundleShipping} shipping{" "}
              <strong>= ${bundleSubtotal + bundleShipping}</strong>
            </span>
            <span className="shop-bundle-shipnote">
              $6 per parcel of up to {RECORDS_PER_PARCEL} records
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setBuySheet({ kind: "bundle" })}
            >
              Request to buy {selectedRecords.length}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        </div>
      ) : null}

      <dialog
        ref={buyDialogRef}
        className="shop-dialog"
        aria-label="Request to buy"
        onClose={() => setBuySheet(null)}
        onClick={(e) => onBackdropClick(e, () => setBuySheet(null))}
      >
        {buySheet && sheetItems.length > 0 ? (
          <div className="shop-dialog-body">
            <div className="shop-dialog-head">
              <h3>Request to buy</h3>
              <button
                type="button"
                className="shop-dialog-close"
                aria-label="Close"
                onClick={() => setBuySheet(null)}
              >
                ×
              </button>
            </div>
            <ul className="shop-dialog-items">
              {sheetItems.map((r) => (
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
                ${sheetQuote.subtotal} + ${sheetQuote.shipping} shipping
              </span>
              <strong>= ${sheetQuote.total}</strong>
            </div>
            <p className="shop-dialog-hint">
              {hasPost
                ? "Two quick steps, per subreddit rules: open the pre-filled Reddit DM (edit anything before sending), then paste the copied comment on the sale post."
                : "This opens a pre-filled Reddit DM — edit anything before sending."}{" "}
              Everything happens on Reddit; no account needed here.
            </p>
            {buySheet.kind === "single" ? (
              <a
                className="btn btn-primary btn-block"
                href={requestToBuyUrl(buySheet.record, hasPost)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => track(buySheet.record.id, "buy_request")}
              >
                {hasPost ? "1. Open the pre-filled DM ↗" : "Open the pre-filled DM ↗"}
              </a>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={sendCombinedRequest}
              >
                {combinedMessageCopied
                  ? "Message copied — paste into the DM"
                  : hasPost
                    ? "1. Open the pre-filled DM ↗"
                    : "Open the pre-filled DM ↗"}
              </button>
            )}
            {hasPost ? (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() =>
                  buySheet.kind === "single"
                    ? copyCommentAndOpenPost(buySheet.record)
                    : copyCombinedCommentAndOpenPost()
                }
              >
                {(
                  buySheet.kind === "single"
                    ? commentCopiedId === buySheet.record.id
                    : combinedCommentCopied
                )
                  ? "Comment copied!"
                  : "2. Copy comment & open the post"}
              </button>
            ) : null}
          </div>
        ) : null}
      </dialog>

      <dialog
        ref={lightboxRef}
        className="shop-lightbox"
        aria-label="Record photos"
        onClose={() => setLightbox(null)}
        onClick={(e) => onBackdropClick(e, () => setLightbox(null))}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") stepLightbox(1);
          if (e.key === "ArrowLeft") stepLightbox(-1);
        }}
      >
        {lightbox
          ? (() => {
              const photos = lightbox.record.photo_urls ?? [];
              const src = photos[lightbox.index];
              if (!src) return null;
              return (
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
                    if (Math.abs(dx) > 40) stepLightbox(dx < 0 ? 1 : -1);
                  }}
                >
                  <div className="shop-lightbox-top">
                    <span className="shop-lightbox-title">
                      {lightbox.record.artist} — {lightbox.record.title}
                    </span>
                    <span className="shop-lightbox-count">
                      {lightbox.index + 1} / {photos.length}
                    </span>
                    <button
                      type="button"
                      className="shop-dialog-close"
                      aria-label="Close photos"
                      onClick={() => setLightbox(null)}
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
                        onClick={() => stepLightbox(-1)}
                      >
                        ‹
                      </button>
                    ) : null}
                    <Image
                      key={src}
                      src={src}
                      alt={`${lightbox.record.artist} — ${lightbox.record.title}, photo ${lightbox.index + 1} of ${photos.length}`}
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
                        onClick={() => stepLightbox(1)}
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
                          className={i === lightbox.index ? "is-active" : ""}
                          aria-label={`Photo ${i + 1}`}
                          onClick={() =>
                            setLightbox((l) => (l ? { ...l, index: i } : l))
                          }
                        >
                          <Image src={u} alt="" width={80} height={80} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })()
          : null}
      </dialog>

      <dialog
        ref={detailDialogRef}
        className="shop-dialog shop-detail"
        aria-label="Record details"
        onClose={() => setDetail(null)}
        onClick={(e) => onBackdropClick(e, () => setDetail(null))}
      >
        {detail
          ? (() => {
              const r = detail;
              const cover = r.photo_urls?.[0] || r.cover_image;
              const tint = tintFor(r.artist);
              return (
                <div className="shop-dialog-body">
                  <div className="shop-dialog-head">
                    <h3 className="shop-detail-title">
                      {r.artist} — {r.title}
                    </h3>
                    <button
                      type="button"
                      className="shop-dialog-close"
                      aria-label="Close"
                      onClick={() => setDetail(null)}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    className="record-cover shop-detail-cover"
                    style={cover ? undefined : { background: tint.bg }}
                  >
                    {cover ? (
                      r.photo_urls?.length ? (
                        <button
                          type="button"
                          className="record-cover-btn"
                          onClick={() => openLightbox(r, 0)}
                          aria-label={`View photos of ${r.artist} — ${r.title}`}
                        >
                          <Image
                            src={cover}
                            alt={`${r.artist} — ${r.title}`}
                            width={600}
                            height={600}
                            sizes="(min-width: 640px) 480px, 100vw"
                          />
                        </button>
                      ) : (
                        <Image
                          src={cover}
                          alt={`${r.artist} — ${r.title}`}
                          width={600}
                          height={600}
                          sizes="(min-width: 640px) 480px, 100vw"
                        />
                      )
                    ) : (
                      <span className="initials" style={{ color: tint.text }}>
                        {initials(r.artist)}
                      </span>
                    )}
                  </div>
                  {r.photo_urls?.length > 1 ? (
                    <div className="record-thumbs">
                      {r.photo_urls.slice(1, 5).map((url, i) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => openLightbox(r, i + 1)}
                          aria-label={`View photo ${i + 2} of ${r.artist} — ${r.title}`}
                        >
                          <Image
                            src={url}
                            alt=""
                            width={150}
                            height={150}
                            sizes="110px"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="record-meta">
                    {r.pressing}
                    {r.collection ? ` · ${r.collection}` : ""}
                  </div>
                  {recordDetails(r)}
                </div>
              );
            })()
          : null}
      </dialog>

      <span className="visually-hidden" aria-live="polite">
        {liveMessage}
      </span>
    </>
  );
}
