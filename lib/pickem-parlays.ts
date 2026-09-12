// House parlays, computed from the house picks. Each pick's price becomes a
// fair probability, nudged by the house confidence; legs are scored by
// probability times payout and the best ones are stacked two to seven deep.
// Pure and browser-safe so it runs under node --test.
import {
  americanToDecimal,
  legLabel,
  legLineAndPrice,
  opposingPrice,
  parlayAmericanOdds,
  type Market,
  type ParlayLeg,
  type PickemGame,
} from "./pickem.ts";

/** Logit shift per confidence point above 5. At -110: 6 ≈ 54%, 7 ≈ 58%, 8 ≈ 62%, 9 ≈ 66%, 10 ≈ 70%. */
export const CONF_LOGIT_STEP = 0.165;
/** A leg needs probability × decimal odds above 1 + MIN_EDGE to be a candidate. */
export const MIN_EDGE = 0.02;
/** Shorter favorites add nothing to a ticket; longer dogs are where confidence is least reliable. */
export const PRICE_MIN = -400;
export const PRICE_MAX = 300;
export const LEG_COUNTS = [2, 3, 4, 5, 6, 7] as const;

const MARKETS: Market[] = ["spread", "total", "ml"];

/** Probability implied by an American price, vig included. */
export function impliedProbability(price: number): number {
  const p = price === 0 ? 100 : price;
  return p > 0 ? 100 / (p + 100) : -p / (-p + 100);
}

/** Vig removed when both sides are known and the pair overrounds; otherwise the implied number. */
export function fairProbability(price: number, opposing: number | null | undefined): number {
  const a = impliedProbability(price);
  if (opposing == null) return a;
  const sum = a + impliedProbability(opposing);
  return sum > 1 ? a / sum : a;
}

/** Fair probability nudged by house confidence. 5 means the number is fair; below 5 counts as 5. */
export function estimatedProbability(fair: number, confidence: number): number {
  const c = Math.min(10, Math.max(5, confidence));
  const f = Math.min(0.98, Math.max(0.02, fair));
  const logit = Math.log(f / (1 - f)) + (c - 5) * CONF_LOGIT_STEP;
  const p = 1 / (1 + Math.exp(-logit));
  return Math.min(0.98, Math.max(0.02, p));
}

export type CandidateLeg = ParlayLeg & { confidence: number; p: number; score: number; kickoff: string };

/** One leg per pending game with picks: the market with the most edge, if it has any. Sorted best first. */
export function candidateLegs(games: PickemGame[], now: number): CandidateLeg[] {
  const out: CandidateLeg[] = [];
  for (const g of games) {
    if (!g.house || g.completed || Date.parse(g.commence_time) <= now) continue;
    let top: CandidateLeg | null = null;
    for (const market of MARKETS) {
      const call = g.house[market];
      if (!call) continue;
      const sel = call.pick;
      const fits = market === "total" ? sel === "over" || sel === "under" : sel === "home" || sel === "away";
      if (!fits) continue;
      const { line, price } = legLineAndPrice(g, market, sel);
      if (market !== "ml" && line == null) continue;
      if (price < PRICE_MIN || price > PRICE_MAX) continue;
      const p = estimatedProbability(fairProbability(price, opposingPrice(g, market, sel)), call.confidence);
      const score = p * americanToDecimal(price);
      const leg: CandidateLeg = {
        game_id: g.id,
        market,
        selection: sel,
        line,
        price,
        label: legLabel(g, market, sel),
        confidence: call.confidence,
        p,
        score,
        kickoff: g.commence_time,
      };
      if (!top || score > top.score || (score === top.score && p > top.p)) top = leg;
    }
    if (top && top.score > 1 + MIN_EDGE) out.push(top);
  }
  return out.sort((a, b) => b.score - a.score || b.p - a.p || a.game_id.localeCompare(b.game_id));
}

export type ParlayDraft = {
  leg_count: number;
  name: string;
  note: string;
  legs: ParlayLeg[];
  american_odds: number;
  hit_probability: number;
  locks_at: string;
  /** Sorted legs joined, for spotting a ticket that already exists. */
  signature: string;
};

export function parlaySignature(legs: Pick<ParlayLeg, "game_id" | "market" | "selection">[]): string {
  return legs
    .map((l) => `${l.game_id}:${l.market}:${l.selection}`)
    .sort()
    .join("|");
}

const WORDS = ["", "", "two", "three", "four", "five", "six", "seven"];

export function parlayNote(k: number, hitProbability: number, ev: number): string {
  const pct = hitProbability < 0.1 ? (hitProbability * 100).toFixed(1) : `${Math.round(hitProbability * 100)}`;
  const evPct = Math.round(ev * 100);
  return `The ${WORDS[k] ?? k} legs with the most edge over the price. House puts it at ${pct}% to hit, ${evPct >= 0 ? "+" : ""}${evPct}% expected value on a unit.`;
}

/** One ticket per leg count, 2 through 7, each the top legs by edge. Skips counts the slate cannot fill. */
export function buildParlays(games: PickemGame[], now: number): ParlayDraft[] {
  const legs = candidateLegs(games, now);
  const out: ParlayDraft[] = [];
  for (const k of LEG_COUNTS) {
    if (legs.length < k) break;
    const top = legs.slice(0, k);
    const hit = Math.round(top.reduce((acc, l) => acc * l.p, 1) * 10000) / 10000;
    const ev = top.reduce((acc, l) => acc * l.score, 1) - 1;
    out.push({
      leg_count: k,
      name: `${k}-leg parlay`,
      note: parlayNote(k, hit, ev),
      legs: top.map(({ game_id, market, selection, line, price, label, confidence }) => ({ game_id, market, selection, line, price, label, confidence })),
      american_odds: parlayAmericanOdds(top.map((l) => l.price)),
      hit_probability: hit,
      locks_at: top.map((l) => l.kickoff).sort()[0],
      signature: parlaySignature(top),
    });
  }
  return out;
}
