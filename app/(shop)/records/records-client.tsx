"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  FREE_SHIPPING_MIN,
  LETTERS,
  SELLER_INFO,
  artistLetter,
} from "@/lib/records";
import {
  cleanDiscogsName,
  GRADE_FLOORS,
  PRICE_BANDS,
  dropPct,
  gradeInfo,
  inPriceBand,
  isNew,
  isOnHold,
  isReduced,
  meetsGrade,
  pressingDecade,
  recordPath,
} from "@/lib/record-info";
import type { DbRecord } from "@/lib/supabase";
import {
  BundleBar,
  BuyDialog,
  PhotoLightbox,
  initials,
  prefersReducedMotion,
  tintFor,
  track,
  useBundle,
  type BuySheet,
  type LightboxState,
} from "./shop-ui";

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

export default function RecordsClient({
  records,
  redditPostUrl,
}: {
  records: DbRecord[];
  redditPostUrl: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("artist");
  // Sold records stay a click away but don't crowd the default view.
  const [avail, setAvail] = useState<AvailOption>("open");
  const [genre, setGenre] = useState<string>("all");
  const [grade, setGrade] = useState<string>("any");
  const [priceBand, setPriceBand] = useState<string>("any");
  const [decade, setDecade] = useState<string>("all");
  const [collection, setCollection] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  const [buySheet, setBuySheet] = useState<BuySheet | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [view, setView] = useState<ViewOption | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [stuck, setStuck] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");

  const controlsRef = useRef<HTMLElement | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const urlSynced = useRef(false);

  // Derived from `records` (not `visible`) so filters never drop a selection.
  const bundle = useBundle(records);
  const selectedRecords = bundle.selectedRecords;

  function clearFilters() {
    setQuery("");
    setSort("artist");
    setAvail("open");
    setGenre("all");
    setGrade("any");
    setPriceBand("any");
    setDecade("all");
    setCollection(null);
    setLetter(null);
  }

  // Closing the sheet after a sent bundle request also empties the bundle:
  // those records are spoken for.
  const closeBuySheet = useCallback(
    (sentBundle: boolean) => {
      if (sentBundle) bundle.clear();
      setBuySheet(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = records.filter((r) => {
      if (avail === "open" && r.sold) return false;
      if (avail === "sold" && !r.sold) return false;
      if (genre !== "all" && !(r.genres ?? []).includes(genre)) return false;
      if (grade !== "any" && !meetsGrade(r.media, grade)) return false;
      if (priceBand !== "any" && !inPriceBand(r.price, priceBand)) return false;
      if (decade !== "all" && pressingDecade(r.pressing) !== decade) return false;
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
  }, [records, query, sort, avail, genre, grade, priceBand, decade, collection, letter]);

  // The rail only features drops worth a look (≥5% or ≥$5); smaller overnight
  // ticks still get the per-card "Drink me" tag but don't headline a section.
  const drops = useMemo(
    () =>
      records.filter((r) => {
        if (r.sold || !isReduced(r)) return false;
        const delta = Number(r.prev_price) - r.price;
        return delta >= 5 || dropPct(r) >= 5;
      }),
    [records]
  );

  // Listed in the last NEW_WINDOW_DAYS and still for sale, newest first.
  const justIn = useMemo(
    () =>
      records
        .filter((r) => !r.sold && isNew(r))
        .sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() -
            new Date(a.created_at ?? 0).getTime()
        ),
    [records]
  );

  const decades = useMemo(
    () =>
      [
        ...new Set(
          records
            .map((r) => pressingDecade(r.pressing))
            .filter((d): d is string => d !== null)
        ),
      ].sort(),
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
    avail !== "open" ||
    genre !== "all" ||
    grade !== "any" ||
    priceBand !== "any" ||
    decade !== "all" ||
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
      : `${available} available · ${records.length - available} sold`;

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
      // The card is filtered out — reset filters (sold included, since a
      // deep link may point at one), then jump after re-render.
      clearFilters();
      setAvail("all");
      window.setTimeout(go, 80);
    }
  }

  function scrollToTop() {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  // ── URL state: read once on mount (?q=&sort=&genre=&avail=&cond=&price=
  // &decade=&coll=&letter=
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
    const cond = params.get("cond");
    if (cond && (GRADE_FLOORS as readonly string[]).includes(cond)) setGrade(cond);
    const pr = params.get("price");
    if (pr && PRICE_BANDS.some((b) => b.key === pr)) setPriceBand(pr);
    const dec = params.get("decade");
    if (dec && /^\d{4}s$/.test(dec)) setDecade(dec);
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
      if (avail !== "open") p.set("avail", avail);
      if (grade !== "any") p.set("cond", grade);
      if (priceBand !== "any") p.set("price", priceBand);
      if (decade !== "all") p.set("decade", decade);
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
  }, [query, sort, genre, avail, grade, priceBand, decade, collection, letter]);

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

  function openLightbox(r: DbRecord, index: number) {
    track(r.id, "photo_open");
    setLightbox({ record: r, index });
  }

  // Tags, notes, price row, and buy actions on a full record card.
  function recordDetails(r: DbRecord) {
    const held = isOnHold(r) && !r.sold;
    const reduced = isReduced(r) && !r.sold;
    return (
      <>
        <div className="record-tags">
          <span className="tag tag-outline" title={gradeInfo(r.media)?.meaning}>
            Media: {r.media}
          </span>
          <span className="tag tag-outline" title={gradeInfo(r.sleeve)?.name}>
            Sleeve: {r.sleeve}
          </span>
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
          <Link href={recordPath(r)}>
            Details<span className="visually-hidden"> for {r.artist} — {r.title}</span> →
          </Link>
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
              className={`record-select ${bundle.has(r.id) ? "is-selected" : ""}`}
              aria-pressed={bundle.has(r.id)}
              onClick={() => bundle.toggle(r.id)}
            >
              {bundle.has(r.id) ? "✓ In your bundle" : "+ Add to bundle"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setBuySheet({ kind: "single", record: r })}
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
    const href = recordPath(r);
    const inBundle = bundle.has(r.id) && !r.sold && !held;
    if (effectiveView === "compact") {
      return (
        <Link
          key={r.id}
          id={`r-${r.id}`}
          href={href}
          className={`card elev-sm record-compact ${r.sold ? "is-sold" : ""} ${
            inBundle ? "is-selected" : ""
          } ${highlightId === r.id ? "is-highlighted" : ""}`}
          aria-label={`${r.artist} — ${r.title}, $${r.price}${
            r.sold ? ", sold" : held ? ", on hold" : ""
          }`}
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
          <span className="record-compact-price">
            ${r.price}
            <span className="record-compact-grade">
              {r.media}/{r.sleeve}
            </span>
          </span>
        </Link>
      );
    }
    return (
      <article
        key={r.id}
        id={`r-${r.id}`}
        className={`card elev-sm record-card ${r.sold ? "is-sold" : ""} ${
          inBundle ? "is-selected" : ""
        } ${highlightId === r.id ? "is-highlighted" : ""}`}
      >
        <div className="record-cover-wrap">
          <Link
            href={href}
            className="record-cover"
            style={cover ? undefined : { background: tint.bg }}
            tabIndex={-1}
            aria-hidden="true"
          >
            {cover ? (
              <Image
                src={cover}
                alt=""
                width={600}
                height={600}
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 100vw"
              />
            ) : (
              <span className="initials" style={{ color: tint.text }}>
                {initials(r.artist)}
              </span>
            )}
          </Link>
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
            <Link href={href}>
              {r.artist} — {r.title}
            </Link>
          </div>
          <div className="record-meta">
            {cleanDiscogsName(r.pressing)}
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

  return (
    <>
      {drops.length > 0 ? (
        <section className="shop-shell shop-section">
          <div className="shop-section-head">
            <h2>Drink me — overnight price drops</h2>
            <span className="shop-muted">
              prices track Discogs daily — these fell overnight
            </span>
          </div>
          <div className="shop-drops">
            {drops.map((r) => {
              const tint = tintFor(r.artist);
              const cover = r.photo_urls?.[0] || r.cover_image;
              return (
                <Link
                  key={r.id}
                  href={recordPath(r)}
                  className="shop-drop-chip"
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
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {justIn.length > 0 ? (
        <section className="shop-shell shop-section">
          <div className="shop-section-head">
            <h2>Just in</h2>
            <span className="shop-muted">
              new to the shelves in the last two weeks
            </span>
          </div>
          <div className="shop-drops">
            {justIn.map((r) => {
              const tint = tintFor(r.artist);
              const cover = r.photo_urls?.[0] || r.cover_image;
              return (
                <Link
                  key={r.id}
                  href={recordPath(r)}
                  className="shop-drop-chip shop-new-chip"
                >
                  <span
                    className="thumb"
                    style={cover ? undefined : { background: tint.bg }}
                  >
                    {cover ? (
                      <Image src={cover} alt="" width={68} height={68} />
                    ) : (
                      initials(r.artist)
                    )}
                  </span>
                  <span className="name">
                    {r.artist} — {r.title}
                  </span>
                  <span className="tag tag-outline">${r.price}</span>
                </Link>
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

        <div className="shop-filter-row" role="group" aria-label="More filters">
          <select
            className="input"
            aria-label="Filter by condition"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          >
            <option value="any">Condition: Any</option>
            {GRADE_FLOORS.map((g) => (
              <option key={g} value={g}>
                {g} or better
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Filter by price"
            value={priceBand}
            onChange={(e) => setPriceBand(e.target.value)}
          >
            <option value="any">Price: Any</option>
            {PRICE_BANDS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </select>
          {decades.length > 1 ? (
            <select
              className="input"
              aria-label="Filter by pressing decade"
              value={decade}
              onChange={(e) => setDecade(e.target.value)}
            >
              <option value="all">Pressed: Any decade</option>
              {decades.map((d) => (
                <option key={d} value={d}>
                  Pressed in the {d}
                </option>
              ))}
            </select>
          ) : null}
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
          Request to buy by email or Reddit DM — no account needed on this
          site. Bundle up: one or two records ship for $6, {FREE_SHIPPING_MIN}{" "}
          or more ship free.
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
            <button
              type="button"
              className="btn btn-ghost shop-sticky-filters"
              onClick={() =>
                controlsRef.current?.scrollIntoView({
                  behavior: prefersReducedMotion() ? "auto" : "smooth",
                })
              }
            >
              Filters{hasFilters ? " •" : ""}
            </button>
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

      <BundleBar
        records={selectedRecords}
        onRequest={() => setBuySheet({ kind: "bundle" })}
        onClear={bundle.clear}
      />

      <BuyDialog
        sheet={buySheet}
        bundleRecords={selectedRecords}
        redditPostUrl={redditPostUrl}
        onClose={closeBuySheet}
        announce={setLiveMessage}
      />

      <PhotoLightbox state={lightbox} onChange={setLightbox} />

      <span className="visually-hidden" aria-live="polite">
        {liveMessage}
      </span>
    </>
  );
}
