"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import {
  LETTERS,
  RECORDS_PER_PARCEL,
  SELLER_INFO,
  artistLetter,
  combinedShipping,
} from "@/lib/records";
import type { DbRecord } from "@/lib/supabase";

type SortOption = "artist" | "price-asc" | "price-desc" | "discount" | "newest";
type AvailOption = "all" | "open" | "sold";

const NEW_WINDOW_DAYS = 14;

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
      NEW_WINDOW_DAYS * 24 * 3600 * 1000
  );
}

function isOnHold(r: DbRecord) {
  return !!r.hold_until && new Date(r.hold_until).getTime() > Date.now();
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
// the pressing line per record to keep the compose URL short.
function combinedRequestMessage(list: DbRecord[], hasPost: boolean) {
  const subject = `Record purchase: ${list.length} records from your list`;
  const lines = list.map(
    (r, i) =>
      `${i + 1}. ${r.artist} — ${r.title} — Media: ${r.media} / Sleeve: ${r.sleeve} — $${r.price}`
  );
  const subtotal = list.reduce((s, r) => s + r.price, 0);
  const shipping = combinedShipping(list.length);
  const parcels = Math.ceil(list.length / RECORDS_PER_PARCEL);
  const commentLine = hasPost
    ? "\nI'll also comment on your Reddit post to confirm I sent this DM.\n"
    : "";
  const message = `Hi! I am interested in purchasing these titles from you:\n\n${lines.join(
    "\n"
  )}\n\nSubtotal: $${subtotal}\nShipping (${parcels} parcel${parcels === 1 ? "" : "s"} of up to ${RECORDS_PER_PARCEL} records): $${shipping}\nTotal: $${subtotal + shipping}\n${commentLine}\n(Found on https://curiouserrecords.com)\n\n`;
  return { subject, message };
}

function combinedRequestUrl(list: DbRecord[], hasPost: boolean) {
  const { subject, message } = combinedRequestMessage(list, hasPost);
  return `https://www.reddit.com/message/compose/?to=${SELLER_INFO.redditUsername}&subject=${encodeURIComponent(subject)}&message=${encodeURIComponent(message)}`;
}

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

  async function copyCommentAndOpenPost(r: DbRecord) {
    const comment = `Sent you a DM about ${r.artist} — ${r.title}!`;
    try {
      await navigator.clipboard.writeText(comment);
      setCommentCopiedId(r.id);
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
    const hasPost = Boolean(redditPostUrl);
    const url = combinedRequestUrl(selectedRecords, hasPost);
    if (url.length <= 2000) {
      window.open(url, "_blank", "noopener");
      return;
    }
    // Compose URLs past ~2k chars get truncated — copy the body instead and
    // open the compose window with just the subject.
    const { subject, message } = combinedRequestMessage(selectedRecords, hasPost);
    try {
      await navigator.clipboard.writeText(message);
      setCombinedMessageCopied(true);
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

  function focusDrop(r: DbRecord) {
    clearFilters();
    setQuery(r.title);
  }

  function recordCard(r: DbRecord) {
    const cover = r.photo_urls?.[0] || r.cover_image;
    const held = isOnHold(r) && !r.sold;
    const reduced = isReduced(r) && !r.sold;
    const tint = tintFor(r.artist);
    return (
      <article
        key={r.id}
        className={`card elev-sm record-card ${r.sold ? "is-sold" : ""} ${
          selected.has(r.id) && !r.sold && !held ? "is-selected" : ""
        }`}
      >
        <div className="record-cover-wrap">
          <div
            className="record-cover"
            style={cover ? undefined : { background: tint.bg }}
          >
            {cover ? (
              r.photo_urls?.length ? (
                <a
                  href={r.photo_urls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "block", width: "100%", height: "100%" }}
                >
                  <Image
                    src={cover}
                    alt={`${r.artist} — ${r.title}`}
                    width={600}
                    height={600}
                  />
                </a>
              ) : (
                <Image
                  src={cover}
                  alt={`${r.artist} — ${r.title}`}
                  width={600}
                  height={600}
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
            {r.photo_urls.slice(1, 5).map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                <Image
                  src={url}
                  alt={`${r.artist} — ${r.title} photo`}
                  width={150}
                  height={150}
                />
              </a>
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
          <a href={discogsUrl(r)} target="_blank" rel="noopener noreferrer">
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
              onClick={() => toggleSelected(r.id)}
            >
              {selected.has(r.id) ? "✓ In your bundle" : "+ Add to bundle"}
            </button>
            <a
              className="btn btn-primary btn-block"
              href={requestToBuyUrl(r, Boolean(redditPostUrl))}
              target="_blank"
              rel="noopener noreferrer"
            >
              {redditPostUrl ? "1. Request to buy" : "Request to buy"}
            </a>
            {redditPostUrl ? (
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() => copyCommentAndOpenPost(r)}
              >
                {commentCopiedId === r.id
                  ? "Comment copied!"
                  : "2. Comment on the post"}
              </button>
            ) : null}
          </>
        ) : null}
      </article>
    );
  }

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
                  onClick={() => focusDrop(r)}
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

      <section className="shop-shell shop-section shop-controls">
        <div className="shop-controls-row">
          <input
            type="search"
            className="input search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What are you curious about? Artist, title, label…"
          />
          <select
            className="input"
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
          <div className="seg">
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
        </div>

        {collections.length > 0 ? (
          <div className="shop-chip-row">
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
          <span className="shop-muted" style={{ marginLeft: "var(--space-2)" }}>
            {visible.length} shown · {available} available of {records.length}{" "}
            listed
          </span>
          {hasFilters ? (
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>
      </section>

      <main className="shop-shell shop-main">
        {visible.length > 0 ? (
          <>
            <div className="shop-grid">{visible.map(recordCard)}</div>
            <p className="shop-grid-hint">
              {redditPostUrl
                ? "Step 1 opens a pre-filled Reddit message you can edit before sending. Step 2 copies a “Sent you a DM” comment and opens the Reddit post — paste it there per sub rules."
                : "“Request to buy” opens a pre-filled Reddit message you can edit before sending."}{" "}
              After several? “Add to bundle” collects records into one combined
              request — shipping is $6 per parcel of up to {RECORDS_PER_PARCEL}{" "}
              records.
            </p>
          </>
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
      </main>

      {selectedRecords.length > 0 ? (
        <div className="shop-bundle-bar" role="region" aria-label="Your bundle">
          <div className="shop-shell shop-bundle-inner">
            <span className="shop-bundle-summary">
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
              onClick={sendCombinedRequest}
            >
              {combinedMessageCopied
                ? "Message copied — paste into the DM"
                : redditPostUrl
                  ? `1. Request to buy ${selectedRecords.length}`
                  : `Request to buy ${selectedRecords.length}`}
            </button>
            {redditPostUrl ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={copyCombinedCommentAndOpenPost}
              >
                {combinedCommentCopied
                  ? "Comment copied!"
                  : "2. Comment on the post"}
              </button>
            ) : null}
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
    </>
  );
}
