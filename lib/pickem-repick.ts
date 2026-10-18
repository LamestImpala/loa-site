// Scoped re-picks: which games a house run asks Claude about when the run is
// limited to named games (`?games=`) or to games with news since a time
// (`?since=`), the second pass of a two-pass week (README, "Two-pass week").
// Pure and browser-safe so it runs under node --test.
import { newestNewsDate, type NewsDigest } from "./pickem-signals.ts";

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
 * The newest news date in a digest when it counts as news after `after`, else
 * null. The digest must have been researched after `after` (so the digest a
 * call was shown never re-triggers it), and its newest dated item must fall on
 * or after `after`'s Eastern calendar day. Items carry only a day, so news
 * from the afternoon of the call's own day counts; that re-picks some games
 * whose news the call already had, which is the cheaper mistake.
 */
export function newsAfter(news: Pick<NewsDigest, "injuries" | "suspensions" | "coaching" | "researched_at"> | undefined, after: string): string | null {
  if (!news || !(Date.parse(news.researched_at) > Date.parse(after))) return null;
  const newest = newestNewsDate(news);
  if (!newest) return null;
  return itemYmd(newest) >= easternYmd(after) ? newest : null;
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
