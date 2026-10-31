/*
 * Display helpers for one shop record — shared by the catalog grid, the
 * per-record page (/r/<id>-<slug>), the sitemap and the admin import.
 * Pure functions only, so they run on the server, the client and in tests.
 */
import type { DbRecord, Track } from "./supabase";

export const NEW_WINDOW_DAYS = 14;
// Was-prices and discount badges clear from view a day after the change.
export const REDUCED_WINDOW_HOURS = 24;

export function isNew(r: Pick<DbRecord, "created_at">, now = Date.now()) {
  return (
    !!r.created_at &&
    now - new Date(r.created_at).getTime() < NEW_WINDOW_DAYS * 24 * 3600 * 1000
  );
}

// Reduced = price dropped and the change is recent enough to still matter.
export function isReduced(
  r: Pick<DbRecord, "prev_price" | "price" | "updated_at">,
  now = Date.now()
) {
  return (
    r.prev_price != null &&
    Number(r.prev_price) > r.price &&
    now - new Date(r.updated_at).getTime() < REDUCED_WINDOW_HOURS * 3600 * 1000
  );
}

export function isOnHold(r: Pick<DbRecord, "hold_until">, now = Date.now()) {
  return !!r.hold_until && new Date(r.hold_until).getTime() > now;
}

export function dropPct(r: Pick<DbRecord, "prev_price" | "price">) {
  return Math.round((1 - r.price / Number(r.prev_price)) * 100);
}

export function discogsUrl(r: Pick<DbRecord, "discogs_release_id" | "artist" | "title">) {
  return r.discogs_release_id
    ? `https://www.discogs.com/release/${r.discogs_release_id}`
    : `https://www.discogs.com/search/?q=${encodeURIComponent(`${r.artist} ${r.title}`)}&type=release`;
}

// "Black Pumas — Chronicles Of A Diamond" → "black-pumas-chronicles-of-a-diamond".
// Accents fold to ASCII; anything else non-alphanumeric becomes a hyphen.
export function recordSlug(r: Pick<DbRecord, "artist" | "title">) {
  return `${r.artist} ${r.title}`
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

// Public path on curiouserrecords.com; proxy.ts rewrites it to /records/r/….
export function recordPath(r: Pick<DbRecord, "id" | "artist" | "title">) {
  const slug = recordSlug(r);
  return slug ? `/r/${r.id}-${slug}` : `/r/${r.id}`;
}

// Leading id of a "/r/<id>-<slug>" segment, or null when there isn't one.
export function idFromSlug(segment: string): number | null {
  const m = segment.match(/^(\d+)(?:-|$)/);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Discogs disambiguates same-named labels and artists with " (3)"; buyers
// don't need to see it. Only a short bare number in parens is stripped, so
// a year like "(2020)" survives.
export function cleanDiscogsName(s: string) {
  return s.replace(/\s\(\d{1,3}\)(?=\s|,|$)/g, "");
}

export function pressingYear(pressing: string): number | null {
  const m = pressing.match(/^(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

// The pressing line is "year · label catno · format descriptions", built at
// import. Split it back out for the record page's spec table; older or
// hand-edited lines that don't fit the shape fall through as `rest`.
export function splitPressing(pressing: string) {
  const parts = cleanDiscogsName(pressing)
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  const year = parts[0] && /^\d{4}$/.test(parts[0]) ? parts.shift()! : null;
  const label = parts.shift() ?? null;
  const formats = parts.join(" · ") || null;
  return { year, label, formats };
}

export type ReleaseDetails = {
  tracklist: Track[];
  country: string;
  barcode: string;
  styles: string[];
};

type DiscogsTrack = {
  position?: string;
  type_?: string;
  title?: string;
  duration?: string;
  sub_tracks?: DiscogsTrack[];
};

// The fields the record page shows, from a Discogs /releases/:id response.
// Headings ("Side A") are dropped — positions already carry the side — and
// index tracks (medleys, suites) list their sub-tracks.
export function releaseDetailsFromDiscogs(rel: {
  tracklist?: DiscogsTrack[];
  country?: string;
  identifiers?: { type?: string; value?: string }[];
  styles?: string[];
}): ReleaseDetails {
  const tracklist: Track[] = [];
  const add = (t: DiscogsTrack) => {
    if (!t.title?.trim()) return;
    tracklist.push({
      position: t.position?.trim() ?? "",
      title: t.title.trim(),
      duration: t.duration?.trim() ?? "",
    });
  };
  for (const t of rel.tracklist ?? []) {
    if (t.type_ === "heading") continue;
    if (t.type_ === "index" && t.sub_tracks?.length) t.sub_tracks.forEach(add);
    else add(t);
  }
  const rawBarcode =
    rel.identifiers?.find((i) => i.type === "Barcode")?.value ?? "";
  const digits = rawBarcode.replace(/\D/g, "");
  return {
    tracklist,
    country: rel.country?.trim() ?? "",
    barcode: digits.length >= 8 && digits.length <= 14 ? digits : "",
    styles: rel.styles ?? [],
  };
}

// Side letter of a vinyl position ("A1" → "A", "C" → "C"); "" for numeric
// positions (CD-style "1", "2"), which then render as one list.
export function trackSide(position: string) {
  const m = position.match(/^([A-Z])\d*\b/i);
  return m ? m[1].toUpperCase() : "";
}

export function groupBySide(tracks: Track[]) {
  const sides: { side: string; tracks: Track[] }[] = [];
  for (const t of tracks) {
    const side = trackSide(t.position);
    const last = sides[sides.length - 1];
    if (last && last.side === side) last.tracks.push(t);
    else sides.push({ side, tracks: [t] });
  }
  return sides;
}

// Goldmine grades, best to worst — the footer cheat-sheet and the record
// page's condition block both read from here.
export const GRADES: { code: string; name: string; meaning: string }[] = [
  { code: "M", name: "Mint", meaning: "Sealed or flawless; never played." },
  { code: "NM", name: "Near Mint", meaning: "Looks and plays as new. No marks worth mentioning." },
  { code: "VG+", name: "Very Good Plus", meaning: "Light signs of play, maybe faint marks that don't affect sound. Plays clean." },
  { code: "VG", name: "Very Good", meaning: "Visible wear and light surface noise in quiet passages, but it plays through." },
  { code: "VG-", name: "Very Good Minus", meaning: "Heavier wear; surface noise is noticeable but the music is still on top." },
  { code: "G+", name: "Good Plus", meaning: "Obvious wear and noise throughout, but no skips. A stand-in copy." },
  { code: "G", name: "Good", meaning: "Heavy wear and constant noise; still plays without skipping." },
  { code: "F", name: "Fair", meaning: "May skip or repeat — for the cover or completists only." },
  { code: "P", name: "Poor", meaning: "Cracked, warped or unplayable. Wall art." },
];

export function gradeInfo(code: string) {
  return GRADES.find((g) => g.code === code.trim().toUpperCase()) ?? null;
}

// "More from the shelves" on a record page: up to three labelled groups,
// each a few available records, no record repeated across groups.
export function relatedGroups<R extends DbRecord>(
  current: R,
  all: R[],
  perGroup = 4,
  now = Date.now()
) {
  const pool = all.filter(
    (r) => r.id !== current.id && !r.sold && !isOnHold(r, now)
  );
  const used = new Set<number>();
  const take = (list: R[]) => {
    const picked = list.filter((r) => !used.has(r.id)).slice(0, perGroup);
    picked.forEach((r) => used.add(r.id));
    return picked;
  };
  const byPriceGap = (a: R, b: R) =>
    Math.abs(a.price - current.price) - Math.abs(b.price - current.price);

  const groups: { title: string; href: string; records: R[] }[] = [];
  const artist = current.artist.trim().toLowerCase();
  const sameArtist = take(pool.filter((r) => r.artist.trim().toLowerCase() === artist));
  if (sameArtist.length) {
    groups.push({
      title: `More by ${cleanDiscogsName(current.artist)}`,
      href: `/?q=${encodeURIComponent(current.artist)}`,
      records: sameArtist,
    });
  }
  if (current.collection) {
    const sameCollection = take(
      pool.filter((r) => r.collection === current.collection).sort(byPriceGap)
    );
    if (sameCollection.length) {
      groups.push({
        title: `More from the ${current.collection} shelf`,
        href: `/?coll=${encodeURIComponent(current.collection)}`,
        records: sameCollection,
      });
    }
  }
  const genre = current.genres?.[0];
  if (genre) {
    // Shared styles first (closer neighbours), then price proximity.
    const styles = new Set(current.styles ?? []);
    const shared = (r: R) => (r.styles ?? []).filter((s) => styles.has(s)).length;
    const sameGenre = take(
      pool
        .filter((r) => (r.genres ?? []).includes(genre))
        .sort((a, b) => shared(b) - shared(a) || byPriceGap(a, b))
    );
    if (sameGenre.length) {
      groups.push({
        // A sold record's price stays off the page, heading included.
        title: current.sold ? `More ${genre}` : `More ${genre} around $${current.price}`,
        href: `/?genre=${encodeURIComponent(genre)}`,
        records: sameGenre,
      });
    }
  }
  return groups;
}

// "45 records sold since August 2026" — the shop's track record. Left out
// (null) until there are enough sales for it to reassure rather than worry.
export function trackRecordLine(
  stats: { soldCount: number; firstSale: string | null } | null,
  min = 10
) {
  if (!stats || stats.soldCount < min) return null;
  const since = stats.firstSale
    ? new Date(stats.firstSale).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "America/Phoenix",
      })
    : null;
  return `${stats.soldCount} records sold${since ? ` since ${since}` : ""}`;
}

// ── Catalog filters ──────────────────────────────────────────────────────

// Position on the Goldmine scale (0 = M); unknown grades sort last.
export function gradeRank(code: string) {
  const i = GRADES.findIndex((g) => g.code === code.trim().toUpperCase());
  return i === -1 ? GRADES.length : i;
}

// "NM or better" etc. — the media grade is what buyers filter on.
export const GRADE_FLOORS = ["NM", "VG+", "VG"] as const;

export function meetsGrade(media: string, floor: string) {
  return gradeRank(media) <= gradeRank(floor);
}

export const PRICE_BANDS = [
  { key: "under20", label: "Under $20", min: 0, max: 20 },
  { key: "20to40", label: "$20–$40", min: 20, max: 40 },
  { key: "40up", label: "$40 and up", min: 40, max: Infinity },
] as const;

export function inPriceBand(price: number, key: string) {
  const band = PRICE_BANDS.find((b) => b.key === key);
  return !band || (price >= band.min && price < band.max);
}

// Decade of the pressing ("1970s"), from the year that leads the pressing
// line; null when the line has no year.
export function pressingDecade(pressing: string) {
  const year = pressingYear(pressing);
  return year ? `${Math.floor(year / 10) * 10}s` : null;
}
