// The house's own record, as text it is shown after the slate: win rate and
// closing line value by confidence, by basis and by market, and last week's
// calls with how the line moved after them. Read from the views in
// supabase/migrations/20261014_pickem_house_calibration.sql. Pure and
// browser-safe so it runs under node --test.
import {
  displayTeam,
  fmtSpread,
  LEAGUE_META,
  tallyAvgClv,
  tallyCalibration,
  tallyWinPct,
  type CalibrationRow,
  type CalibrationTally,
  type League,
  type Market,
  type Selection,
} from "./pickem.ts";

/** A row with fewer calls than this is shown as too few to judge, with no rate. */
export const FEEDBACK_MIN_CALLS = 25;
/** Last week's calls shown, at most: the best and worst by CLV, half each. */
export const LAST_WEEK_MAX = 30;

/** One row of pickem_house_last_week. */
export type LastWeekRow = {
  league: League;
  season: number;
  week: number;
  game_id: string;
  /** "Away Team @ Home Team", full names. */
  matchup: string;
  commence_time: string;
  market: Market;
  selection: Selection;
  confidence: number;
  basis: string;
  line: number | null;
  price: number | null;
  close_line: number | null;
  clv: number | null;
  result: "win" | "loss" | "push" | null;
  why: string;
};

/** What the house is told about the block, ahead of it. */
export const FEEDBACK_INTRO = `Below the slate is your own record from our database. It is evidence about which kinds of reasons have earned a 6 and whether your 7s have been worth two units: where a confidence or a basis has lost to the closing line and to the scoreboard over a real sample, hold that kind of call to a higher bar. It is not a reason to pick any game, and it must not move your confidence on any game without a reason specific to that game. Rows marked "too few to judge" are noise. Last week's calls show which of your early reads the market later agreed with (positive CLV: the line moved your way before kickoff) and which it moved against.`;

const signed = (n: number, places = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(places)}`;
const pct = (p: number | null) => (p == null ? "—" : `${(p * 100).toFixed(1)}%`);

function wlp(t: Pick<CalibrationTally, "wins" | "losses" | "pushes">): string {
  return `${t.wins}-${t.losses}${t.pushes ? `-${t.pushes}` : ""}`;
}

/** "53.0% (116-103-7), CLV -0.05 on 137, +4.2u", or "too few to judge (16 calls)". */
export function fmtTally(t: CalibrationTally, opts: { units?: boolean; clv?: boolean } = {}): string {
  if (t.calls < FEEDBACK_MIN_CALLS) return `too few to judge (${t.calls} call${t.calls === 1 ? "" : "s"})`;
  const parts = [`${pct(tallyWinPct(t))} (${wlp(t)})`];
  const clv = tallyAvgClv(t);
  if (opts.clv !== false && clv != null) parts.push(`CLV ${signed(clv)} on ${t.clv_calls}`);
  if (opts.units) parts.push(`${signed(t.units, 1)}u at its stakes`);
  return parts.join(", ");
}

function groupBy<K>(rows: CalibrationRow[], key: (r: CalibrationRow) => K): Map<K, CalibrationTally> {
  const by = new Map<K, CalibrationRow[]>();
  for (const r of rows) by.set(key(r), [...(by.get(key(r)) ?? []), r]);
  return new Map([...by].map(([k, rs]) => [k, tallyCalibration(rs)]));
}

const BASIS_ORDER = ["news", "matchup", "number", "movement", "none", "untagged"];
const MARKET_NAME: Record<Market, string> = { spread: "spread", total: "total", ml: "moneyline" };

/**
 * The record block: by confidence (spread and total, passes included), by
 * basis and by market (calls at 6 and up). Under about 1,500 characters for a
 * full season of rows.
 */
export function recordBlock(league: League, season: number, rows: CalibrationRow[]): string {
  const mine = rows.filter((r) => r.league === league && Number(r.season) === season);
  if (!mine.length) return "";
  const ats = mine.filter((r) => r.market !== "ml");
  const plays = mine.filter((r) => Number(r.confidence) >= 6);

  const byConf = [...groupBy(ats, (r) => Number(r.confidence))].sort((a, b) => a[0] - b[0]);
  const rank = (basis: string) => (BASIS_ORDER.includes(basis) ? BASIS_ORDER.indexOf(basis) : BASIS_ORDER.length);
  const byBasis = [...groupBy(plays.filter((r) => r.market !== "ml"), (r) => r.basis)].sort(
    (x, y) => rank(x[0]) - rank(y[0]) || x[0].localeCompare(y[0])
  );
  const byMarket = groupBy(plays, (r) => r.market);

  const lines = [
    `YOUR RECORD, ${LEAGUE_META[league].label} ${season}: the latest call on every completed game. Win% leaves pushes out; CLV is points better than the last line before kickoff.`,
    "By confidence, spread and total:",
    ...byConf.map(([c, t]) => `  ${c}: ${fmtTally(t, { units: c >= 6 })}`),
  ];
  if (byBasis.length) lines.push("By basis, spread and total at 6+:", ...byBasis.map(([b, t]) => `  ${b}: ${fmtTally(t)}`));
  if (byMarket.size) {
    lines.push("By market at 6+:");
    for (const m of ["spread", "total", "ml"] as Market[]) {
      const t = byMarket.get(m);
      if (!t) continue;
      // A moneyline's win rate is not against a number; its units are what count.
      const text = m === "ml" ? (t.calls < FEEDBACK_MIN_CALLS ? fmtTally(t) : `${wlp(t)}, ${signed(t.units, 1)}u at its stakes`) : fmtTally(t, { units: true });
      lines.push(`  ${MARKET_NAME[m]}: ${text}`);
    }
  }
  return lines.join("\n");
}

/** "Alabama -9" or "Under 47 (Kentucky @ Alabama)", from the matchup string. */
export function lastWeekLabel(league: League, r: Pick<LastWeekRow, "matchup" | "market" | "selection" | "line">): string {
  const [away = "", home = ""] = r.matchup.split(" @ ");
  if (r.market === "total") {
    return `${r.selection === "over" ? "Over" : "Under"} ${r.line ?? "—"} (${displayTeam(league, away)} @ ${displayTeam(league, home)})`;
  }
  const team = displayTeam(league, r.selection === "home" ? home : away);
  return r.market === "ml" ? `${team} ML` : `${team} ${fmtSpread(r.line)}`;
}

const RESULT: Record<string, string> = { win: "W", loss: "L", push: "P" };

/**
 * Last week's plays on the spread and total with a CLV, best CLV first; past
 * LAST_WEEK_MAX, the best and worst halves. A summary line covers the passes.
 */
export function lastWeekBlock(league: League, rows: LastWeekRow[]): string {
  const mine = rows.filter((r) => r.league === league && r.market !== "ml" && r.clv != null);
  if (!mine.length) return "";
  const week = mine[0].week;
  const plays = mine.filter((r) => r.confidence >= 6).sort((a, b) => Number(b.clv) - Number(a.clv) || a.game_id.localeCompare(b.game_id));
  const passes = mine.filter((r) => r.confidence < 6);
  const avg = (xs: LastWeekRow[]) => xs.reduce((n, r) => n + Number(r.clv), 0) / xs.length;
  const tally = (xs: LastWeekRow[]) => ({
    wins: xs.filter((r) => r.result === "win").length,
    losses: xs.filter((r) => r.result === "loss").length,
    pushes: xs.filter((r) => r.result === "push").length,
  });

  const lines = [`LAST WEEK (week ${week}), spread and total calls at 6+, best CLV first:`];
  const fmt = (r: LastWeekRow) =>
    `  ${r.confidence} ${r.basis} · ${lastWeekLabel(league, r)} · closed ${r.market === "total" ? r.close_line : fmtSpread(r.close_line)} · CLV ${signed(Number(r.clv), 1)} · ${r.result ? RESULT[r.result] : "no final"} · ${r.why}`;
  if (plays.length > LAST_WEEK_MAX) {
    const half = LAST_WEEK_MAX / 2;
    lines.push(...plays.slice(0, half).map(fmt), `  … ${plays.length - LAST_WEEK_MAX} more in between …`, ...plays.slice(-half).map(fmt));
  } else {
    lines.push(...plays.map(fmt));
  }
  if (plays.length) lines.push(`  Plays: ${wlp(tally(plays))}, average CLV ${signed(avg(plays))} on ${plays.length}.`);
  else lines.push("  No plays.");
  if (passes.length) lines.push(`  Passes (5s): average CLV ${signed(avg(passes))} on ${passes.length}.`);
  return lines.join("\n");
}

/** The whole block appended after the slate, intro included; empty when there is no record yet. */
export function houseFeedback(league: League, season: number, calibration: CalibrationRow[], lastWeek: LastWeekRow[]): string {
  const blocks = [recordBlock(league, season, calibration), lastWeekBlock(league, lastWeek)].filter(Boolean);
  return blocks.length ? [FEEDBACK_INTRO, ...blocks].join("\n\n") : "";
}

// ---------------------------------------------------------------------------
// The admin page's calibration table: the same rows, filtered by market and
// added up by one column.

export type CalibrationSplit = "confidence" | "basis" | "prompt_version";

export function calibrationTable(
  rows: CalibrationRow[],
  opts: { market: Market | "all"; by: CalibrationSplit }
): { key: string; tally: CalibrationTally }[] {
  const kept = rows.filter((r) => opts.market === "all" || r.market === opts.market);
  const by = groupBy(kept, (r) => String(r[opts.by]));
  // Confidence ascending, bases in BASIS_ORDER, prompts newest first with the unversioned ones last.
  const order = (k: string) =>
    opts.by === "confidence"
      ? Number(k)
      : opts.by === "basis"
        ? BASIS_ORDER.includes(k) ? BASIS_ORDER.indexOf(k) : BASIS_ORDER.length
        : Number(k === "unversioned");
  return [...by]
    .map(([key, tally]) => ({ key, tally }))
    .sort((a, b) => order(a.key) - order(b.key) || (opts.by === "prompt_version" ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)));
}
