// What the pick'em's Claude calls cost. Every house and research run adds up
// the usage its calls reported and stores one row in pickem_job_runs
// (supabase/migrations/20261024_pickem_job_runs.sql) with a cost worked out
// from list prices; the admin page adds the rows up by week. Pure and
// browser-safe so it runs under node --test.
import { seasonWeek, type League } from "./pickem.ts";

/** The fields of the API's usage object that are priced. */
export type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests: number; web_fetch_requests?: number } | null;
};

export type UsageTotals = {
  /** Calls that reported usage. A call that timed out or was refused reports none and is not here. */
  calls: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  web_searches: number;
};

export const EMPTY_TOTALS: UsageTotals = { calls: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, web_searches: 0 };

export function sumUsage(items: Iterable<UsageLike | null | undefined>): UsageTotals {
  const t = { ...EMPTY_TOTALS };
  for (const u of items) {
    if (!u) continue;
    t.calls++;
    t.input_tokens += u.input_tokens;
    t.output_tokens += u.output_tokens;
    t.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    t.cache_write_tokens += u.cache_creation_input_tokens ?? 0;
    t.web_searches += u.server_tool_use?.web_search_requests ?? 0;
  }
  return t;
}

/**
 * USD per million tokens on the Claude API, from the pricing page
 * (platform.claude.com/docs/en/about-claude/pricing), read 2026-10-24. Opus 5.5
 * is the model the jobs use; the others are what a safety refusal can fall
 * back to, or what the jobs could be moved to. input_tokens in the usage
 * object are the uncached ones, so each kind is priced on its own.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; cache_read: number; cache_write: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  "claude-opus-5": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
};

/** Web search is billed per search on top of the tokens; the results it returns are input tokens. */
export const WEB_SEARCH_USD = 0.01;

/** The price row for a model id, exact or by prefix ("claude-opus-5-5-…"), else undefined. */
export function modelPrices(model: string | null | undefined) {
  if (!model) return undefined;
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const key = Object.keys(MODEL_PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? MODEL_PRICES[key] : undefined;
}

/** One call's cost in USD at the model that served it (a fallback can change it), or null for a model without a price. */
export function callCostUsd(u: UsageLike, model: string | null | undefined): number | null {
  const p = modelPrices(model);
  if (!p) return null;
  const perM = (n: number | null | undefined, price: number) => ((n ?? 0) * price) / 1_000_000;
  return (
    perM(u.input_tokens, p.input) +
    perM(u.output_tokens, p.output) +
    perM(u.cache_read_input_tokens, p.cache_read) +
    perM(u.cache_creation_input_tokens, p.cache_write) +
    (u.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_USD
  );
}

/** A run's calls priced one by one. cost_usd is the sum of the priced ones; unpriced counts those at a model with no price. */
export function runCost(calls: { usage?: UsageLike | null; model?: string | null }[], defaultModel: string): { cost_usd: number; unpriced: number } {
  let cost_usd = 0;
  let unpriced = 0;
  for (const c of calls) {
    if (!c.usage) continue;
    const cost = callCostUsd(c.usage, c.model ?? defaultModel);
    if (cost == null) unpriced++;
    else cost_usd += cost;
  }
  return { cost_usd: Math.round(cost_usd * 10000) / 10000, unpriced };
}

/** What a run reports and stores (the row's token columns, plus the cost). */
export type JobSpend = UsageTotals & {
  /** Calls that returned no usage (timeout, refusal, deadline). */
  failed: number;
  /** Estimated USD at list prices; null when no call could be priced. */
  cost_usd: number | null;
  model: string;
  /** False when the pickem_job_runs insert failed (the migration not applied yet). */
  recorded?: boolean;
};

export type JobRunRow = {
  league: League;
  job: "house" | "research";
  dry: boolean;
  started_at: string;
  calls: number;
  failed?: number;
  input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  output_tokens: number;
  web_searches: number;
  /** numeric comes back from PostgREST as a string. */
  cost_usd: number | string | null;
};

export type WeekSpend = {
  week: number;
  runs: number;
  calls: number;
  web_searches: number;
  input_tokens: number;
  output_tokens: number;
  house_usd: number;
  research_usd: number;
  /** The part of the total spent on dry runs (previews), which are already inside house_usd and research_usd. */
  dry_usd: number;
  cost_usd: number;
};

const num = (x: number | string | null | undefined) => (x == null ? 0 : Number(x));

/** The rows of one league added up by season week (weeks roll over Tuesday 10:00 UTC), newest first. */
export function spendByWeek(rows: JobRunRow[], league: League): WeekSpend[] {
  const weeks = new Map<number, WeekSpend>();
  for (const r of rows) {
    if (r.league !== league) continue;
    const week = seasonWeek(league, new Date(r.started_at));
    const w = weeks.get(week) ?? { week, runs: 0, calls: 0, web_searches: 0, input_tokens: 0, output_tokens: 0, house_usd: 0, research_usd: 0, dry_usd: 0, cost_usd: 0 };
    const cost = num(r.cost_usd);
    w.runs++;
    w.calls += r.calls;
    w.web_searches += r.web_searches;
    w.input_tokens += r.input_tokens + r.cache_read_tokens + r.cache_write_tokens;
    w.output_tokens += r.output_tokens;
    if (r.job === "house") w.house_usd += cost;
    else w.research_usd += cost;
    if (r.dry) w.dry_usd += cost;
    w.cost_usd += cost;
    weeks.set(week, w);
  }
  return [...weeks.values()].sort((a, b) => b.week - a.week);
}

/** Every week added together; week is 0. */
export function spendTotal(weeks: WeekSpend[]): WeekSpend {
  const t: WeekSpend = { week: 0, runs: 0, calls: 0, web_searches: 0, input_tokens: 0, output_tokens: 0, house_usd: 0, research_usd: 0, dry_usd: 0, cost_usd: 0 };
  for (const w of weeks) {
    t.runs += w.runs;
    t.calls += w.calls;
    t.web_searches += w.web_searches;
    t.input_tokens += w.input_tokens;
    t.output_tokens += w.output_tokens;
    t.house_usd += w.house_usd;
    t.research_usd += w.research_usd;
    t.dry_usd += w.dry_usd;
    t.cost_usd += w.cost_usd;
  }
  return t;
}

export const fmtUsd = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

/** 1,234,567 → "1.2M", 45,678 → "46k". */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
