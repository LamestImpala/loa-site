"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { SELLER_INFO } from "@/lib/records";
import type { DbRecord } from "@/lib/supabase";

type SortOption = "artist" | "price-asc" | "price-desc";
type FilterOption = "all" | "available" | "sold";

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

function artistLetter(artist: string) {
  const first = artist.trim().charAt(0).toUpperCase();
  return first >= "A" && first <= "Z" ? first : "#";
}

// Reddit markdown pipes inside a cell break the table — escape them.
function cell(s: string | undefined) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

function requestToBuyUrl(r: DbRecord, hasPost: boolean) {
  const subject = `Record purchase: ${r.artist} — ${r.title}`;
  const commentLine = hasPost
    ? "\nI'll also comment on your Reddit post to confirm I sent this DM.\n"
    : "";
  const message = `Hi! I am interested in purchasing this title from you:\n\n${r.artist} — ${r.title}\n${r.pressing}\nMedia: ${r.media} / Sleeve: ${r.sleeve} — $${r.price}\n${commentLine}\n(Found on https://lateonsetaudiophile.com/records)\n\n`;
  return `https://www.reddit.com/message/compose/?to=${SELLER_INFO.redditUsername}&subject=${encodeURIComponent(subject)}&message=${encodeURIComponent(message)}`;
}

function redditMarkdown(records: DbRecord[]) {
  const list = records
    .filter((r) => !r.sold)
    .sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title));
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

export default function RecordsClient({
  records,
  redditPostUrl,
}: {
  records: DbRecord[];
  redditPostUrl: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("artist");
  const [filter, setFilter] = useState<FilterOption>("all");
  const [letter, setLetter] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [commentCopiedId, setCommentCopiedId] = useState<number | null>(null);

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = records.filter((r) => {
      if (filter === "available" && r.sold) return false;
      if (filter === "sold" && !r.sold) return false;
      if (letter && artistLetter(r.artist) !== letter) return false;
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
  }, [records, query, sort, filter, letter]);

  const activeLetters = useMemo(
    () => new Set(records.map((r) => artistLetter(r.artist))),
    [records]
  );

  const available = records.filter((r) => !r.sold).length;

  async function copyRedditTable() {
    const md = redditMarkdown(records);
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

      <div className="mt-5 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setLetter(null)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
            letter === null
              ? "border-white bg-white text-black"
              : "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
          }`}
        >
          All
        </button>
        {LETTERS.map((l) => {
          const hasRecords = activeLetters.has(l);
          return (
            <button
              key={l}
              type="button"
              disabled={!hasRecords}
              onClick={() => setLetter(letter === l ? null : l)}
              className={`w-8 rounded-lg border px-0 py-1.5 text-center text-xs transition ${
                letter === l
                  ? "border-white bg-white text-black"
                  : hasRecords
                    ? "border-white/15 text-neutral-300 hover:bg-white hover:text-black"
                    : "cursor-default border-white/5 text-neutral-700"
              }`}
            >
              {l}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-sm text-neutral-400">
        {visible.length} shown · {available} available of {records.length}{" "}
        listed
      </p>

      {visible.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8 text-neutral-300">
          No records match.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((r) => (
            <div
              key={r.id}
              className={`relative rounded-2xl border border-white/10 bg-white/5 p-5 transition hover:border-white/25 hover:bg-white/10 ${
                r.sold ? "opacity-50" : ""
              }`}
            >
              {r.sold ? (
                <span className="absolute right-4 top-4 z-10 rounded-full bg-red-800 px-2.5 py-0.5 text-xs font-semibold tracking-wider text-white">
                  SOLD
                </span>
              ) : null}
              {r.cover_image ? (
                <Image
                  src={r.cover_image}
                  alt={`${r.artist} — ${r.title}`}
                  width={600}
                  height={600}
                  className="mb-4 aspect-square w-full rounded-xl object-cover"
                />
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
              {r.photos || r.discogs_release_id ? (
                <p className="mt-2 flex gap-4 text-sm">
                  {r.discogs_release_id ? (
                    <a
                      href={`https://www.discogs.com/release/${r.discogs_release_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-300 underline underline-offset-4 transition hover:text-white"
                    >
                      View on Discogs
                    </a>
                  ) : null}
                  {r.photos ? (
                    <a
                      href={r.photos}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-300 underline underline-offset-4 transition hover:text-white"
                    >
                      Photos
                    </a>
                  ) : null}
                </p>
              ) : null}
              {!r.sold && SELLER_INFO.redditUsername ? (
                <>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href={requestToBuyUrl(r, Boolean(redditPostUrl))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block rounded-full border border-white/15 px-4 py-1.5 text-sm text-white transition hover:bg-white hover:text-black"
                    >
                      1. Request to buy
                    </a>
                    {redditPostUrl ? (
                      <button
                        type="button"
                        onClick={() => copyCommentAndOpenPost(r)}
                        className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-white transition hover:bg-white hover:text-black"
                      >
                        {commentCopiedId === r.id
                          ? "Comment copied!"
                          : "2. Comment on the post"}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    {redditPostUrl
                      ? "Step 1 opens a pre-filled DM you can edit before sending. Step 2 copies a “Sent you a DM” comment and opens the Reddit post — paste it there per sub rules."
                      : "Opens a pre-filled Reddit message you can edit before sending."}
                  </p>
                </>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
