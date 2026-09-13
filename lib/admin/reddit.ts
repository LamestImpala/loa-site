import type { DbRecord, RedditPost } from "@/lib/supabase";
import { FREE_SHIPPING_MIN, SELLER_INFO } from "@/lib/records";
import type { MarketMap, MarketStats } from "./market";

// Reddit post bodies for r/VinylCollectors: the full-catalog table, the
// weekly picks post, the "sold rows struck through" update, and the retire
// body for a superseded post. Pure — no React, no Supabase.


// Reddit markdown pipes inside a cell break the table — escape them.
function cell(s: string | undefined) {
  return String(s || "")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim();
}

// Reddit posts should funnel buyers to the site, where every record has a
// "Request to buy" button that pre-fills the DM; SELLER_INFO.contact stays
// as-is for the site's own hero card.
export const SHOP_URL = "https://curiouserrecords.com";
const REDDIT_HOW_TO_BUY = `**How to buy:** browse the full list with live prices at ${SHOP_URL} — every record has a "Request to buy" button that pre-fills a DM to me. Or just PM me here; I'm happy to complete everything through Reddit messages. First come, first served.

**Offers:** reasonable offers welcome on bundles of ${FREE_SHIPPING_MIN}+ records (which also ship free) — singles are priced as listed.`;

// The first line of each copied post is a ready-made [For Sale] title —
// paste it into Reddit's title field, then delete it from the body.
function topCollections(list: DbRecord[], n: number) {
  const counts = new Map<string, number>();
  for (const r of list)
    if (r.collection)
      counts.set(r.collection, (counts.get(r.collection) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([c]) => c);
}

export function redditMarkdown(records: DbRecord[]) {
  const list = records
    .filter((r) => r.listed && !r.sold)
    .sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title));
  const rows = list.map((r) => {
    const title = r.photos
      ? `[${cell(r.title)}](${r.photos.trim()})`
      : cell(r.title);
    return `| ${cell(r.artist)} | ${title} | $${r.price} | ${cell(r.pressing)} | ${cell(r.media)} | ${cell(r.sleeve)} | ${cell(r.notes)} |`;
  });
  const series = topCollections(list, 3);
  const title = `[For Sale] ${list.length} vinyl records — collection sale, audiophile pressings${series.length ? ` (${series.join(", ")})` : ""} — PayPal G&S`;
  return [
    title,
    "",
    `**${SELLER_INFO.pageTitle}** — browse everything at ${SHOP_URL}`,
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    "| Artist | Title | Price | Pressing | Media | Sleeve | Notes |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

// Weekly post is built from the hand-picked records ("Sel" column), not the
// whole catalog, and never shows an old price — steep markdowns read as
// suspicious to buyers. Price sits right after Title so mobile readers see
// it without scrolling the table sideways. Each title links to its exact
// Discogs release so buyers can check the pressing themselves — the post
// deliberately says nothing about scarcity or demand.

// A price drop recent enough to headline a weekly post.
const DROP_WINDOW_DAYS = 14;
export const isRecentDrop = (r: DbRecord) =>
  r.prev_price != null &&
  Number(r.prev_price) > r.price &&
  Date.now() - new Date(r.updated_at).getTime() <
    DROP_WINDOW_DAYS * 24 * 3600 * 1000;
export const dropPct = (r: DbRecord) => 1 - r.price / Number(r.prev_price);

// Relative demand for ranking picks: wants per existing copy. Not shown
// to buyers — a ratio below 1 reads as weak even when it's the best.
export const demandRatio = (s: MarketStats | undefined) =>
  s && s.want !== null && s.have !== null ? s.want / Math.max(s.have, 1) : null;

// Pressing strings start with the release year ("2023 · Label CATNO · …")
// when Discogs knew it; the weekly table shows just that year.
const pressingYear = (r: DbRecord) =>
  r.pressing.match(/^(\d{4})\b/)?.[1] ?? "";

const weeklyTitle = (r: DbRecord) =>
  r.discogs_release_id
    ? `[${cell(r.title)}](https://www.discogs.com/release/${r.discogs_release_id})`
    : cell(r.title);

const weeklyRow = (r: DbRecord) =>
  `| ${cell(r.artist)} | ${weeklyTitle(r)} | $${r.price} | ${pressingYear(r)} | ${cell(r.media)}/${cell(r.sleeve)} |`;

const REDDIT_TABLE_HEADER = [
  "| Artist | Title | Price | Year | Grade (M/S) |",
  "|---|---|---|---|---|",
];

// The title leads with the three most-wanted artists in the pick (Discogs
// want count) — that is what a collector scanning the sub actually reads —
// and says "price drops" only when the pick carries some.
export function redditWeeklyMarkdown(
  selected: DbRecord[],
  liveCount: number,
  market: MarketMap
) {
  const list = [...selected].sort((a, b) =>
    (a.artist + a.title).localeCompare(b.artist + b.title)
  );
  const drops = list.filter(isRecentDrop).length;
  const headliners: string[] = [];
  for (const r of [...list].sort(
    (a, b) => (market[b.id]?.want ?? 0) - (market[a.id]?.want ?? 0)
  )) {
    if (!headliners.includes(r.artist)) headliners.push(r.artist);
    if (headliners.length === 3) break;
  }
  const title = `[For Sale] ${drops > 0 ? "Price drops + scarce picks" : "Weekly picks"}${
    headliners.length ? ` — ${headliners.map(cell).join(", ")}` : ""
  } — from a ${liveCount}-record collection sale — PayPal G&S, free shipping on ${FREE_SHIPPING_MIN}+`;
  return [
    title,
    "",
    `**Weekly update** — browse everything at ${SHOP_URL}`,
    "",
    ...(drops > 0
      ? [
          `**Price drops** — ${drops} of these ${list.length} came down in the last two weeks; every price below is live.`,
          "",
        ]
      : []),
    ...REDDIT_TABLE_HEADER,
    ...list.map(weeklyRow),
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

// Sold records stay visible as struck-through rows with the price hidden.
const updateRow = (r: DbRecord) =>
  r.sold
    ? `| ~~${cell(r.artist)}~~ | ~~${cell(r.title)}~~ | **SOLD** | ${pressingYear(r)} | ${cell(r.media)}/${cell(r.sleeve)} |`
    : weeklyRow(r);

// Body-only refresh of the live weekly post (Reddit titles can't be edited,
// so there's no title line — paste this over the existing post body).
export function redditUpdateMarkdown(posted: DbRecord[]) {
  const list = [...posted].sort((a, b) =>
    (a.artist + a.title).localeCompare(b.artist + b.title)
  );
  const openCount = list.filter((r) => !r.sold).length;
  return [
    `**Weekly update** — ${openCount} of ${list.length} still available — browse everything at ${SHOP_URL}`,
    "",
    ...REDDIT_TABLE_HEADER,
    ...list.map(updateRow),
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

// r/vinylcollectors caps post bodies at 40k characters.
export const REDDIT_BODY_LIMIT = 40000;

// Body-only "retire" paste for a superseded post: the sub forbids deleting
// posts, so a stale post keeps its table (sold rows struck through) under a
// banner pointing readers at the newest post. No title line — titles can't
// be edited on Reddit.
export function redditStaleMarkdown(
  post: RedditPost,
  posted: DbRecord[],
  newestUrl: string
) {
  const list = [...posted].sort((a, b) =>
    (a.artist + a.title).localeCompare(b.artist + b.title)
  );
  // Full-catalog posts use the wide 7-column table; weekly posts and their
  // updates use the compact weekly columns — match whichever was posted.
  const fullRow = (r: DbRecord) => {
    const title = r.photos
      ? `[${cell(r.title)}](${r.photos.trim()})`
      : cell(r.title);
    return r.sold
      ? `| ~~${cell(r.artist)}~~ | ~~${title}~~ | **SOLD** | ${cell(r.pressing)} | ${cell(r.media)} | ${cell(r.sleeve)} | ${cell(r.notes)} |`
      : `| ${cell(r.artist)} | ${title} | $${r.price} | ${cell(r.pressing)} | ${cell(r.media)} | ${cell(r.sleeve)} | ${cell(r.notes)} |`;
  };
  const table =
    post.kind === "full"
      ? [
          "| Artist | Title | Price | Pressing | Media | Sleeve | Notes |",
          "|---|---|---|---|---|---|---|",
          ...list.map(fullRow),
        ]
      : [...REDDIT_TABLE_HEADER, ...list.map(updateRow)];
  return [
    `**⚠️ This post is outdated — see my [newest post](${newestUrl}) for current availability, or browse everything at ${SHOP_URL}.**`,
    "",
    ...table,
    "",
    `**Location:** ${SELLER_INFO.location}`,
    "",
    `**Payment:** ${SELLER_INFO.payment}`,
    "",
    `**Shipping:** ${SELLER_INFO.shipping}`,
    "",
    REDDIT_HOW_TO_BUY,
  ].join("\n");
}

// Fisher–Yates; returns a new array.
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
