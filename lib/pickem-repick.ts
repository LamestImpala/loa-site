// Scoped re-picks: which games a house run asks Claude about when the run is
// limited to named games (`?games=`) or to games with news since a time
// (`?since=`), the second pass of a two-pass week (README, "Two-pass week").
// Pure and browser-safe so it runs under node --test.
import type { NewsDigest } from "./pickem-signals.ts";

export type RepickScope = {
  /** Only these game ids. */
  games?: string[];
  /** Only games whose latest news digest has news after this ISO time, or after each game's own call with "call". */
  since?: string;
};

/** Whether a scope limits the run at all. A scoped run re-picks its games whether or not `force` is set. */
export const isScoped = (s: RepickScope) => Boolean(s.games?.length || s.since);

/** `?games=id1,id2` and `?since=<iso>|call` from a query string; an error for a `since` that is neither. */
export function parseRepickScope(q: URLSearchParams): RepickScope | { error: string } {
  const scope: RepickScope = {};
  const games = q.get("games")?.split(",").map((s) => s.trim()).filter(Boolean);
  if (games?.length) scope.games = [...new Set(games)];
  const since = q.get("since")?.trim();
  if (since) {
    if (since !== "call" && Number.isNaN(Date.parse(since))) return { error: `since must be an ISO time or "call", got ${since}` };
    scope.since = since === "call" ? since : new Date(since).toISOString();
  }
  return scope;
}

const easternYmd = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** A news item's date as an Eastern calendar day: a bare YYYY-MM-DD is taken as written, a full time is converted. */
const itemYmd = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date : easternYmd(date));

/**
 * The news date that makes a digest count as news after `after`, else null.
 * The digest must have been researched after `after` (so the digest a call
 * was shown never re-triggers it) and hold an item from on or after `after`'s
 * Eastern calendar day: its newest dated item, compared by Eastern day, or,
 * when the digest has an item with no date, the research time itself. The
 * researcher reports this week's news and a final injury report often comes
 * back undated, so an undated item counts as current. Items carry only a day,
 * so news from the afternoon of the call's own day counts too. Both re-pick
 * some games whose news the call already had, which is the cheaper mistake.
 */
export function newsAfter(news: Pick<NewsDigest, "injuries" | "suspensions" | "coaching" | "researched_at"> | undefined, after: string): string | null {
  if (!news || !(Date.parse(news.researched_at) > Date.parse(after))) return null;
  let newest: { date: string; ymd: string } | null = null;
  let undated = false;
  for (const { date } of [...news.injuries, ...news.suspensions, ...news.coaching]) {
    if (!date || Number.isNaN(Date.parse(date))) {
      undated = true;
      continue;
    }
    const ymd = itemYmd(date);
    if (!newest || ymd > newest.ymd) newest = { date, ymd };
  }
  if (newest && newest.ymd >= easternYmd(after)) return newest.date;
  return undated ? news.researched_at : null;
}

type Game = { id: string; house: { picked_at?: string } | null };

export type ScopedGame<G> = { game: G; news?: string };

/**
 * The upcoming games a scoped run re-picks, in slate order, each with the news
 * date that put it in scope when `since` was given. `since: "call"` measures
 * from each game's current call, so a game without one (or one picked before
 * picked_at was stored) is left to the normal run. `unknown` lists requested
 * ids that are not on the slate: started, another week, or a typo.
 */
export function scopeGames<G extends Game>(
  slate: G[],
  scope: RepickScope,
  newsOf: (id: string) => Pick<NewsDigest, "injuries" | "suspensions" | "coaching" | "researched_at"> | undefined
): { games: ScopedGame<G>[]; unknown: string[] } {
  const wanted = scope.games?.length ? new Set(scope.games) : null;
  const games: ScopedGame<G>[] = [];
  for (const g of slate) {
    if (wanted && !wanted.has(g.id)) continue;
    if (!scope.since) {
      games.push({ game: g });
      continue;
    }
    const after = scope.since === "call" ? g.house?.picked_at : scope.since;
    const news = after ? newsAfter(newsOf(g.id), after) : null;
    if (news) games.push({ game: g, news });
  }
  const onSlate = new Set(slate.map((g) => g.id));
  return { games, unknown: (scope.games ?? []).filter((id) => !onSlate.has(id)) };
}
