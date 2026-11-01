"use client";

/*
 * The listing for a kind of item other than records: posters now,
 * equipment next. A trimmed sibling of records-client.tsx — search, sort,
 * availability, a few select filters built from the items themselves, a
 * price band, the cards/covers toggle, URL state, the sticky bar, and the
 * same bundle bar, buy sheet and lightbox. No Goldmine grade filter,
 * decades, genres, A–Z letters or price-drop rails: those are vinyl things.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { PRICE_BANDS, inPriceBand, isNew, isOnHold } from "@/lib/record-info";
import { SELLER_INFO } from "@/lib/records";
import {
  KIND_LABELS,
  KIND_PLURALS,
  itemPath,
  itemSpecShort,
  itemSubtitle,
  posterYear,
} from "@/lib/items";
import type { DbRecord, ItemKind } from "@/lib/supabase";
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

type AvailOption = "all" | "open" | "sold";
type ViewOption = "full" | "compact";
const AVAIL_OPTIONS: AvailOption[] = ["all", "open", "sold"];

// A select filter built from the distinct values the items carry.
type FilterDef = {
  param: string; // URL param and state key
  label: string; // "Year", "Venue"
  valueOf: (r: DbRecord) => string | null;
  sortValues?: (a: string, b: string) => number;
};

type SortDef = { value: string; label: string; compare: (a: DbRecord, b: DbRecord) => number };

type KindConfig = {
  searchPlaceholder: string;
  haystack: (r: DbRecord) => string;
  filters: FilterDef[];
  sorts: SortDef[]; // first is the default
  tags: (r: DbRecord) => string[];
  shippingNote: string;
};

const byPriceAsc = (a: DbRecord, b: DbRecord) => a.price - b.price;
const byPriceDesc = (a: DbRecord, b: DbRecord) => b.price - a.price;
const byNewest = (a: DbRecord, b: DbRecord) =>
  new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
const byName = (a: DbRecord, b: DbRecord) => (a.artist + a.title).localeCompare(b.artist + b.title);

const CONFIG: Record<Exclude<ItemKind, "record">, KindConfig> = {
  poster: {
    searchPlaceholder: "Venue, city, year, poster artist…",
    haystack: (r) => {
      const d = r.details ?? {};
      return `${r.artist} ${r.title} ${d.venue ?? ""} ${d.city ?? ""} ${d.show_date ?? ""} ${d.designer ?? ""} ${d.edition ?? ""}`;
    },
    filters: [
      {
        param: "year",
        label: "Year",
        valueOf: (r) => (posterYear(r) ? String(posterYear(r)) : null),
        sortValues: (a, b) => b.localeCompare(a),
      },
      { param: "venue", label: "Venue", valueOf: (r) => r.details?.venue?.trim() || null },
      { param: "designer", label: "Poster artist", valueOf: (r) => r.details?.designer?.trim() || null },
    ],
    sorts: [
      {
        value: "date",
        label: "Sort: Show date, newest first",
        compare: (a, b) =>
          (b.details?.show_date ?? "").localeCompare(a.details?.show_date ?? "") || byName(a, b),
      },
      { value: "date-asc", label: "Show date, oldest first", compare: (a, b) =>
          (a.details?.show_date ?? "").localeCompare(b.details?.show_date ?? "") || byName(a, b) },
      { value: "price-asc", label: "Price: low → high", compare: byPriceAsc },
      { value: "price-desc", label: "Price: high → low", compare: byPriceDesc },
      { value: "newest", label: "Newest arrivals", compare: byNewest },
    ],
    tags: (r) => {
      const d = r.details ?? {};
      return [
        r.condition ? `Condition: ${r.condition}` : "",
        d.dimensions ?? "",
        d.edition ?? "",
        d.print_method ?? "",
      ].filter(Boolean);
    },
    shippingNote: SELLER_INFO.posterShipping,
  },
  gear: {
    searchPlaceholder: "Brand, model, category…",
    haystack: (r) => {
      const d = r.details ?? {};
      return `${r.artist} ${r.title} ${d.category ?? ""} ${d.included ?? ""}`;
    },
    filters: [
      { param: "cat", label: "Category", valueOf: (r) => r.details?.category?.trim() || null },
      { param: "brand", label: "Brand", valueOf: (r) => r.artist.trim() || null },
      { param: "cond", label: "Condition", valueOf: (r) => r.condition?.trim() || null },
    ],
    sorts: [
      { value: "brand", label: "Sort: Brand A–Z", compare: byName },
      { value: "price-asc", label: "Price: low → high", compare: byPriceAsc },
      { value: "price-desc", label: "Price: high → low", compare: byPriceDesc },
      { value: "newest", label: "Newest arrivals", compare: byNewest },
    ],
    tags: (r) => [r.condition ? `Condition: ${r.condition}` : "", r.details?.category ?? ""].filter(Boolean),
    shippingNote: SELLER_INFO.gearShipping,
  },
};

export default function ItemsClient({
  kind,
  items,
  bundlePool,
  redditPostUrl,
}: {
  kind: Exclude<ItemKind, "record">;
  items: DbRecord[]; // what this page lists
  bundlePool: DbRecord[]; // everything listed, of every kind — the bundle lives across pages
  redditPostUrl: string;
}) {
  const cfg = CONFIG[kind];
  const noun = KIND_PLURALS[kind];
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(cfg.sorts[0].value);
  const [avail, setAvail] = useState<AvailOption>("open");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [priceBand, setPriceBand] = useState("any");
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

  const bundle = useBundle(bundlePool);
  const selected = bundle.selectedRecords;

  function clearFilters() {
    setQuery("");
    setSort(cfg.sorts[0].value);
    setAvail("open");
    setPicks({});
    setPriceBand("any");
  }

  const closeBuySheet = useCallback(
    (sentBundle: boolean) => {
      if (sentBundle) bundle.clear();
      setBuySheet(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Distinct values per select filter, from the items on this page.
  const filterValues = useMemo(
    () =>
      cfg.filters.map((f) => {
        const values = [...new Set(items.map(f.valueOf).filter((v): v is string => !!v))];
        values.sort(f.sortValues ?? ((a, b) => a.localeCompare(b)));
        return { def: f, values };
      }),
    [cfg, items]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((r) => {
      if (avail === "open" && r.sold) return false;
      if (avail === "sold" && !r.sold) return false;
      for (const f of cfg.filters) {
        const want = picks[f.param];
        if (want && f.valueOf(r) !== want) return false;
      }
      if (priceBand !== "any" && !inPriceBand(r.price, priceBand)) return false;
      if (!q) return true;
      return cfg.haystack(r).toLowerCase().includes(q);
    });
    const compare = cfg.sorts.find((s) => s.value === sort)?.compare ?? cfg.sorts[0].compare;
    list.sort(compare);
    return list;
  }, [cfg, items, query, sort, avail, picks, priceBand]);

  const available = items.filter((r) => !r.sold).length;
  const hasFilters =
    query.trim() !== "" ||
    avail !== "open" ||
    priceBand !== "any" ||
    Object.values(picks).some(Boolean);

  const effectiveView: ViewOption = view ?? (isMobile ? "compact" : "full");

  function chooseView(v: ViewOption) {
    setView(v);
    try {
      localStorage.setItem("cr_view", v);
    } catch {
      // The toggle still works for this visit.
    }
  }

  const countLabel = hasFilters
    ? `${visible.length} of ${items.length} ${noun}`
    : available === items.length
      ? `${items.length} ${items.length === 1 ? KIND_LABELS[kind].toLowerCase() : noun}`
      : `${available} available · ${items.length - available} sold`;

  function scrollToItem(id: number) {
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    const go = () => {
      const el = document.getElementById(`r-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior, block: "center" });
      setHighlightId(id);
      window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2400);
    };
    if (document.getElementById(`r-${id}`)) {
      go();
    } else {
      clearFilters();
      setAvail("all");
      window.setTimeout(go, 80);
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  // URL state: read once on mount …
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuery(q);
    const s = params.get("sort");
    if (s && cfg.sorts.some((o) => o.value === s)) setSort(s);
    const a = params.get("avail") as AvailOption | null;
    if (a && AVAIL_OPTIONS.includes(a)) setAvail(a);
    const pr = params.get("price");
    if (pr && PRICE_BANDS.some((b) => b.key === pr)) setPriceBand(pr);
    const initial: Record<string, string> = {};
    for (const f of cfg.filters) {
      const v = params.get(f.param);
      if (v) initial[f.param] = v;
    }
    if (Object.keys(initial).length) setPicks(initial);
    const m = window.location.hash.match(/^#r-(\d+)$/);
    if (m) window.setTimeout(() => scrollToItem(Number(m[1])), 120);
    urlSynced.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // … and write back (debounced — Safari rate-limits replaceState).
  useEffect(() => {
    if (!urlSynced.current) return;
    const t = window.setTimeout(() => {
      const p = new URLSearchParams();
      if (query.trim()) p.set("q", query.trim());
      if (sort !== cfg.sorts[0].value) p.set("sort", sort);
      if (avail !== "open") p.set("avail", avail);
      if (priceBand !== "any") p.set("price", priceBand);
      for (const f of cfg.filters) if (picks[f.param]) p.set(f.param, picks[f.param]);
      const qs = p.toString();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
      );
    }, 300);
    return () => window.clearTimeout(t);
  }, [cfg, query, sort, avail, priceBand, picks]);

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

  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  function openLightbox(r: DbRecord, index: number) {
    track(r.id, "photo_open");
    setLightbox({ record: r, index });
  }

  function itemDetails(r: DbRecord) {
    const held = isOnHold(r) && !r.sold;
    return (
      <>
        <div className="record-tags">
          {cfg.tags(r).map((t) => (
            <span key={t} className="tag tag-outline">
              {t}
            </span>
          ))}
          {r.photo_urls?.length ? <span className="tag tag-neutral">Actual item pictured</span> : null}
        </div>

        {r.notes ? <p className="record-notes">{r.notes}</p> : null}

        <div className="record-price-row">
          {r.sold ? null : <span className="record-price">${r.price}</span>}
          <Link href={itemPath(r)}>
            Details<span className="visually-hidden"> for {r.artist} — {r.title}</span> →
          </Link>
        </div>

        {r.sold ? (
          <button className="btn btn-secondary btn-block" disabled>
            Sold — gone down the rabbit hole
          </button>
        ) : held ? (
          <p className="record-hold-note">
            On hold — the White Rabbit&rsquo;s watch is ticking. Check back in case it falls
            through.
          </p>
        ) : (
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
        )}
      </>
    );
  }

  function itemCard(r: DbRecord) {
    const cover = r.photo_urls?.[0] || "";
    const held = isOnHold(r) && !r.sold;
    const tint = tintFor(r.artist);
    const href = itemPath(r);
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
          aria-label={`${r.artist} — ${r.title}, ${r.sold ? "sold" : `$${r.price}${held ? ", on hold" : ""}`}`}
        >
          <span className="record-compact-cover" style={cover ? undefined : { background: tint.bg }}>
            {cover ? (
              <Image src={cover} alt="" width={300} height={400} sizes="(min-width: 640px) 160px, 33vw" />
            ) : (
              <span className="initials" style={{ color: tint.text }}>
                {initials(r.artist)}
              </span>
            )}
            {r.sold ? (
              <span
                className="tag record-mini-badge"
                style={{ background: "var(--color-neutral-800)", color: "var(--color-neutral-100)" }}
              >
                SOLD
              </span>
            ) : held ? (
              <span className="tag tag-accent record-mini-badge">HOLD</span>
            ) : null}
          </span>
          <span className="record-compact-title">
            {r.artist} — {r.title}
          </span>
          <span className="record-compact-price">
            {r.sold ? null : `$${r.price}`}
            <span className="record-compact-grade">{itemSpecShort(r)}</span>
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
                height={800}
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
              style={{ background: "var(--color-neutral-800)", color: "var(--color-neutral-100)" }}
            >
              SOLD
            </span>
          ) : held ? (
            <span className="tag tag-accent record-badge-tl">ON HOLD</span>
          ) : null}
          {isNew(r) && !r.sold ? <span className="tag tag-accent record-badge-tr">New arrival</span> : null}
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
                <Image src={url} alt="" width={150} height={150} sizes="(min-width: 640px) 90px, 25vw" />
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
          <div className="record-meta">{itemSubtitle(r)}</div>
        </div>

        {itemDetails(r)}
      </article>
    );
  }

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

  const sortSelect = (className: string) => (
    <select
      className={className}
      aria-label={`Sort ${noun}`}
      value={sort}
      onChange={(e) => setSort(e.target.value)}
      style={{ width: "auto" }}
    >
      {cfg.sorts.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <section id="records" ref={controlsRef} className="shop-shell shop-section shop-controls">
        <div className="shop-controls-row">
          <input
            type="search"
            className="input search"
            aria-label={`Search ${noun}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={cfg.searchPlaceholder}
          />
          {sortSelect("input")}
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
          {filterValues
            .filter(({ values }) => values.length > 1)
            .map(({ def, values }) => (
              <select
                key={def.param}
                className="input"
                aria-label={`Filter by ${def.label.toLowerCase()}`}
                value={picks[def.param] ?? ""}
                onChange={(e) => setPicks((prev) => ({ ...prev, [def.param]: e.target.value }))}
              >
                <option value="">{def.label}: Any</option>
                {values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ))}
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
          <span className="shop-muted">{countLabel}</span>
          {hasFilters ? (
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
        </div>

        <p className="shop-controls-note">
          Request to buy by email or Reddit DM — no account needed on this site. {cfg.shippingNote}
        </p>
      </section>

      {stuck ? (
        <div className="shop-sticky-bar">
          <div className="shop-shell shop-sticky-inner">
            <input
              type="search"
              className="input search"
              aria-label={`Search ${noun}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${noun}…`}
            />
            {sortSelect("input shop-sticky-sort")}
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
          <div className={`shop-grid kind-${kind} view-${effectiveView} ${stuck ? "has-sticky-bar" : ""}`}>
            {visible.map(itemCard)}
          </div>
        ) : items.length === 0 ? (
          <div className="card shop-empty">
            <div className="shop-empty-title">Nothing on the wall just yet.</div>
            <p className="shop-muted" style={{ margin: 0 }}>
              Check back soon, or email{" "}
              <a href={`mailto:${SELLER_INFO.contactEmail}`}>{SELLER_INFO.contactEmail}</a> to ask
              what&rsquo;s coming.
            </p>
          </div>
        ) : (
          <div className="card shop-empty">
            <div className="shop-empty-title">Nothing here matches that.</div>
            <button type="button" className="btn btn-ghost" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </div>

      <BundleBar
        records={selected}
        onRequest={() => setBuySheet({ kind: "bundle" })}
        onClear={bundle.clear}
      />
      <BuyDialog
        sheet={buySheet}
        bundleRecords={selected}
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
