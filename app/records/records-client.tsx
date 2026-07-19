"use client";

import { useMemo, useState } from "react";
import { RECORDS, SELLER_INFO } from "@/lib/records";

type SortOption = "artist" | "price-asc" | "price-desc";
type FilterOption = "all" | "available" | "sold";

// Reddit markdown pipes inside a cell break the table — escape them.
function cell(s: string | undefined) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function redditMarkdown() {
  const list = RECORDS.filter((r) => !r.sold).sort((a, b) =>
    (a.artist + a.title).localeCompare(b.artist + b.title)
  );
  const rows = list.map((r) => {
    const title = r.photos
      ? `[${cell(r.title)}](${r.photos.trim()})`
      : cell(r.title);
    return `| ${cell(r.artist)} | ${title} | ${cell(r.pressing)} | ${cell(r.media)} | ${cell(r.sleeve)} | $${r.price} | ${cell(r.notes)} |`;
  });
  return [
    `**${SELLER_INFO.pageTitle}** — full list with photos: ${window.location.href.split("#")[0]}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    "| Artist | Title | Pressing | Media | Sleeve | Price | Notes |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    SELLER_INFO.contact,
  ].join("\n");
}

export default function RecordsClient() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("artist");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [copied, setCopied] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = RECORDS.filter((r) => {
      if (filter === "available" && r.sold) return false;
      if (filter === "sold" && !r.sold) return false;
      if (!q) return true;
      return `${r.artist} ${r.title} ${r.pressing}`.toLowerCase().includes(q);
    });
    list.sort((a, b) =>
      sort === "price-asc"
        ? a.price - b.price
        : sort === "price-desc"
          ? b.price - a.price
          : (a.artist + a.title).localeCompare(b.artist + b.title)
    );
    return list;
  }, [query, sort, filter]);

  const available = RECORDS.filter((r) => !r.sold).length;

  async function copyRedditTable() {
    const md = redditMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API needs HTTPS/localhost; fall back to showing the text.
      window.prompt("Copy the table below:", md);
    }
  }

  return (
    <>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search artist, title, label…"
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none sm:flex-1"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white focus:border-white/30 focus:outline-none [&>option]:bg-neutral-900"
        >
          <option value="artist">Sort: Artist A–Z</option>
          <option value="price-asc">Sort: Price low → high</option>
          <option value="price-desc">Sort: Price high → low</option>
        </select>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterOption)}
          className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white focus:border-white/30 focus:outline-none [&>option]:bg-neutral-900"
        >
          <option value="all">Show all</option>
          <option value="available">Available only</option>
          <option value="sold">Sold only</option>
        </select>
        <button
          type="button"
          onClick={copyRedditTable}
          title="Copies a ready-to-paste Reddit markdown table of available records"
          className="rounded-xl border border-white/15 bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-neutral-200"
        >
          {copied ? "Copied!" : "Copy Reddit table"}
        </button>
      </div>

      <p className="mt-4 text-sm text-neutral-400">
        {visible.length} shown · {available} available of {RECORDS.length}{" "}
        listed
      </p>

      {visible.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8 text-neutral-300">
          No records match.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r, i) => (
            <div
              key={`${r.artist}-${r.title}-${r.pressing}-${i}`}
              className={`relative rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/25 hover:bg-white/10 ${
                r.sold ? "opacity-50" : ""
              }`}
            >
              {r.sold ? (
                <span className="absolute right-4 top-4 rounded-full bg-red-800 px-2.5 py-0.5 text-xs font-semibold tracking-wider text-white">
                  SOLD
                </span>
              ) : null}
              <h2 className={`text-lg font-medium ${r.sold ? "pr-14" : ""}`}>
                {r.artist} — {r.title}
              </h2>
              <p className="mt-1 text-xs text-neutral-400">{r.pressing}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-neutral-300">
                  Media: {r.media}
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-neutral-300">
                  Sleeve: {r.sleeve}
                </span>
              </div>
              <p className="mt-3 text-xl font-semibold text-white">
                ${r.price}
              </p>
              {r.notes ? (
                <p className="mt-2 text-sm text-neutral-300">{r.notes}</p>
              ) : null}
              {r.photos ? (
                <p className="mt-2 text-sm">
                  <a
                    href={r.photos}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neutral-300 underline underline-offset-4 transition hover:text-white"
                  >
                    Photos
                  </a>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
