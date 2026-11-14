"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { SELLER_INFO, artistLetter } from "@/lib/records";
import {
  cleanDiscogsName,
  dropPct,
  isNew,
  isOnHold,
  isReduced,
  pressingDecade,
  recordPath,
} from "@/lib/record-info";
import type { DbRecord } from "@/lib/supabase";
import type { DiscStyle } from "@/lib/disc-style";
import { initials, prefersReducedMotion, tintFor } from "./shop-ui";
import Crate3D from "./crate-3d";
import type { CrateItem } from "./crate-scene";

// How many sleeves stand behind the front one, and how many flipped ones
// stay mounted so the flip can animate out.
const BEHIND = 7;
const FLIPPED = 2;
const SWIPE_PX = 36;

type Jump = { id: number; why: string };

// The 3D bin (crate-3d.tsx) needs WebGL 2, and is skipped for shoppers who
// ask for reduced motion: they keep the flat crate below.
const noStore = () => () => {};
const supports3d = () => "WebGL2RenderingContext" in window && !prefersReducedMotion();

// WebGL can only read images from this site, so covers go through the
// image optimizer (the same URLs next/image builds for the flat crate).
function coverTexture(src: string) {
  return getImageProps({ src, alt: "", width: 320, height: 320 }).props.src;
}

// "Down the rabbit hole": a related record picked at random, weighted by how
// much it shares with the current one, skipping ones already visited.
export function rabbitHole(
  current: DbRecord,
  pool: DbRecord[],
  seen: Set<number>,
  random: () => number = Math.random
): Jump | null {
  const open = pool.filter((r) => r.id !== current.id && !r.sold);
  if (!open.length) return null;
  const fresh = open.filter((r) => !seen.has(r.id));
  const candidates = fresh.length ? fresh : open;

  const artist = current.artist.trim().toLowerCase();
  const genres = new Set(current.genres ?? []);
  const decade = pressingDecade(current.pressing);
  const scored = candidates.map((r) => {
    const links: { w: number; why: string }[] = [];
    if (current.collection && r.collection === current.collection) {
      links.push({ w: 4, why: `another from the ${current.collection} shelf` });
    }
    if (r.artist.trim().toLowerCase() === artist) {
      links.push({ w: 3, why: `more ${cleanDiscogsName(current.artist)}` });
    }
    const genre = (r.genres ?? []).find((g) => genres.has(g));
    if (genre) links.push({ w: 2, why: `more ${genre}` });
    if (decade && pressingDecade(r.pressing) === decade) {
      links.push({ w: 1, why: `also pressed in the ${decade}` });
    }
    return {
      id: r.id,
      weight: links.reduce((s, l) => s + l.w, 0),
      why: links[0]?.why ?? "",
    };
  });

  const related = scored.filter((s) => s.weight > 0);
  if (!related.length) {
    const pick = scored[Math.floor(random() * scored.length)];
    return { id: pick.id, why: "somewhere else entirely" };
  }
  let roll = random() * related.reduce((s, r) => s + r.weight, 0);
  for (const r of related) {
    roll -= r.weight;
    if (roll <= 0) return { id: r.id, why: r.why };
  }
  const last = related[related.length - 1];
  return { id: last.id, why: last.why };
}

export default function Crate({
  records,
  discStyles,
  showTabs,
  paused,
  inBundle,
  onToggleBundle,
  onBuy,
}: {
  records: DbRecord[];
  // Disc colour by record id, where Discogs describes one (lib/disc-style.ts).
  discStyles?: Record<number, DiscStyle>;
  // Letter divider tabs only make sense when the crate is filed A–Z.
  showTabs: boolean;
  // A dialog is open: arrow keys belong to it.
  paused: boolean;
  inBundle: (id: number) => boolean;
  onToggleBundle: (id: number) => void;
  onBuy: (record: DbRecord) => void;
}) {
  // Position is kept as a record id so filters and sorts keep your place.
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [fell, setFell] = useState<{ why: string; n: number } | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const can3d = useSyncExternalStore(noStore, supports3d, () => false);
  const [failed3d, setFailed3d] = useState(false);
  const use3d = can3d && !failed3d;
  const seen = useRef(new Set<number>());
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const found = records.findIndex((r) => r.id === currentId);
  const index = found === -1 ? 0 : found;
  const current = records[index];
  const last = records.length - 1;

  function go(to: number) {
    const next = Math.min(last, Math.max(0, to));
    if (next === index) return;
    setCurrentId(records[next].id);
    setFell(null);
  }

  function fall() {
    seen.current.add(current.id);
    const jump = rabbitHole(current, records, seen.current);
    if (!jump) return;
    seen.current.add(jump.id);
    setCurrentId(jump.id);
    setFell({ why: jump.why, n: (fell?.n ?? 0) + 1 });
  }

  // Arrow keys flip while the crate is on screen and nothing else wants them.
  const keys = useRef({ go, index, last });
  useEffect(() => {
    keys.current = { go, index, last };
  });
  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, select, textarea, [contenteditable='true']")) return;
      const box = stageRef.current?.getBoundingClientRect();
      if (!box || box.bottom < 0 || box.top > window.innerHeight) return;
      const k = keys.current;
      if (e.key === "ArrowRight") k.go(k.index + 1);
      else if (e.key === "ArrowLeft") k.go(k.index - 1);
      else if (e.key === "Home") k.go(0);
      else if (e.key === "End") k.go(k.last);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused]);

  // What the 3D bin draws for each record, in crate order.
  const items = useMemo<CrateItem[]>(
    () =>
      use3d
        ? records.map((r, i) => {
            const cover = r.photo_urls?.[0] || r.cover_image;
            const letter = artistLetter(r.artist);
            return {
              id: r.id,
              cover: cover ? coverTexture(cover) : null,
              initials: initials(r.artist),
              sticker: r.sold ? ["Sold"] : [`$${r.price}`, `${r.media}/${r.sleeve}`],
              sold: r.sold,
              tab:
                showTabs && (i === 0 || artistLetter(records[i - 1].artist) !== letter)
                  ? letter
                  : null,
              disc: discStyles?.[r.id] ?? null,
            };
          })
        : [],
    [use3d, records, showTabs, discStyles]
  );

  if (!current) return null;

  const held = isOnHold(current) && !current.sold;
  const reduced = isReduced(current) && !current.sold;
  const picked = inBundle(current.id);
  const disc = discStyles?.[current.id];
  const from = Math.max(0, index - FLIPPED);
  const to = Math.min(last, index + BEHIND);

  return (
    <section
      className={`crate ${use3d ? "crate-in-3d" : ""}`}
      aria-label="Crate — flip through the records"
    >
      <div className="crate-bin" ref={stageRef}>
        {use3d ? (
          <Crate3D
            items={items}
            index={index}
            fallCount={fell?.n ?? 0}
            onStep={(delta) => go(index + delta)}
            onPick={(at) => go(at === index ? index + 1 : at)}
            onUnavailable={() => setFailed3d(true)}
          />
        ) : (
        <div
          className="crate-stage"
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            swiped.current = false;
          }}
          onPointerUp={(e) => {
            const start = drag.current;
            drag.current = null;
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
            swiped.current = true;
            go(index + (dx < 0 ? 1 : -1));
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <div className="crate-sleeves" key={fell?.n ?? 0} data-fell={fell ? "" : undefined}>
            {records.slice(from, to + 1).map((r, k) => {
              const i = from + k;
              const depth = i - index;
              const cover = r.photo_urls?.[0] || r.cover_image;
              const tint = tintFor(r.artist);
              const letter = artistLetter(r.artist);
              const tab =
                showTabs && (i === 0 || artistLetter(records[i - 1].artist) !== letter);
              return (
                <button
                  key={r.id}
                  type="button"
                  className={`crate-sleeve ${depth < 0 ? "is-flipped" : ""} ${
                    depth === 0 ? "is-front" : ""
                  } ${r.sold ? "is-sold" : ""}`}
                  style={{ ["--d" as string]: depth, zIndex: 50 - depth }}
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => {
                    if (swiped.current) return;
                    go(depth === 0 ? index + 1 : i);
                  }}
                >
                  {tab ? (
                    <span
                      className="crate-tab"
                      style={{ left: `${6 + ((letter.charCodeAt(0) * 7) % 5) * 18}%` }}
                    >
                      {letter}
                    </span>
                  ) : null}
                  <span
                    className="crate-art"
                    style={cover ? undefined : { background: tint.bg }}
                  >
                    {cover ? (
                      <Image
                        src={cover}
                        alt=""
                        width={600}
                        height={600}
                        sizes="(min-width: 760px) 420px, 80vw"
                        draggable={false}
                        priority={depth === 0}
                      />
                    ) : (
                      <span className="initials" style={{ color: tint.text }}>
                        {initials(r.artist)}
                      </span>
                    )}
                  </span>
                  {depth === 0 ? (
                    <span className="crate-sticker">
                      {r.sold ? (
                        "Sold"
                      ) : (
                        <>
                          <b>${r.price}</b>
                          <span>
                            {r.media}/{r.sleeve}
                          </span>
                        </>
                      )}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="crate-lip" aria-hidden="true">
            <span>Curiouser Records</span>
          </div>
        </div>
        )}

        <div className="crate-nav">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => go(index - 1)}
            disabled={index === 0}
          >
            ← Back
          </button>
          <input
            type="range"
            className="crate-scrub"
            min={0}
            max={last}
            value={index}
            onChange={(e) => go(Number(e.target.value))}
            aria-label="Position in the crate"
            aria-valuetext={`${index + 1} of ${records.length}: ${current.artist} — ${current.title}`}
            disabled={last === 0}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => go(index + 1)}
            disabled={index === last}
          >
            Flip →
          </button>
        </div>
        <p className="crate-hint">
          {use3d
            ? "Tap the lifted record or one further back, swipe, or use the ← → keys."
            : "Tap the front record, swipe, or use the ← → keys."}
        </p>
      </div>

      <div className="card elev-sm crate-plate">
        <div className="crate-count">
          {index + 1} of {records.length}
          {fell ? <span className="crate-fell"> · you fell into {fell.why}</span> : null}
        </div>
        <h3 className="crate-title">
          <Link href={recordPath(current)}>
            {current.artist} — {current.title}
          </Link>
        </h3>
        <div className="record-meta">
          {cleanDiscogsName(current.pressing)}
          {current.collection ? ` · ${current.collection}` : ""}
        </div>

        <div className="record-tags">
          <span className="tag tag-outline">Media: {current.media}</span>
          <span className="tag tag-outline">Sleeve: {current.sleeve}</span>
          {disc ? <span className="tag tag-outline">Disc: {disc.label}</span> : null}
          {current.photo_urls?.length ? (
            <span className="tag tag-neutral">Actual copy pictured</span>
          ) : null}
          {isNew(current) && !current.sold ? (
            <span className="tag tag-accent">New arrival</span>
          ) : null}
          {reduced ? (
            <span className="tag tag-accent-2">Drink me · ↓ {dropPct(current)}%</span>
          ) : null}
        </div>

        {current.notes ? <p className="record-notes">{current.notes}</p> : null}

        <div className="record-price-row">
          {reduced ? (
            <span className="record-prev-price">${current.prev_price}</span>
          ) : null}
          {current.sold ? null : <span className="record-price">${current.price}</span>}
          <Link href={recordPath(current)}>
            Details
            <span className="visually-hidden">
              {" "}
              for {current.artist} — {current.title}
            </span>{" "}
            →
          </Link>
        </div>

        {current.sold ? (
          <button className="btn btn-secondary btn-block" disabled>
            Sold — gone down the rabbit hole
          </button>
        ) : held ? (
          <p className="record-hold-note">
            On hold — the White Rabbit&rsquo;s watch is ticking. Check back in case
            it falls through.
          </p>
        ) : SELLER_INFO.redditUsername ? (
          <>
            <button
              type="button"
              className={`record-select ${picked ? "is-selected" : ""}`}
              aria-pressed={picked}
              onClick={() => onToggleBundle(current.id)}
            >
              {picked ? "✓ In your bundle" : "+ Add to bundle"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => onBuy(current)}
            >
              Request to buy
            </button>
          </>
        ) : null}

        {records.length > 1 ? (
          <button type="button" className="crate-hole" onClick={fall}>
            Down the rabbit hole
            <span aria-hidden="true"> ↓</span>
          </button>
        ) : null}
      </div>

      <span className="visually-hidden" aria-live="polite">
        {current.artist} — {current.title}
        {current.sold ? ", sold" : `, $${current.price}`}, {index + 1} of{" "}
        {records.length}
      </span>
    </section>
  );
}
