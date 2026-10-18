// House prompt experiments. Every call is made under one variant of the
// house prompt; the record is split by variant in pickem_house_experiment
// (supabase/migrations/20261015_pickem_house_variants.sql) and a variant is
// promoted by hand, by editing HOUSE_VARIANTS. Pure and browser-safe so it
// runs under node --test.
import type { League } from "./pickem.ts";

// Bump whenever houseSystem (lib/pickem-server.ts) changes, so the record can
// be split by prompt. Every variant's prompt_version is built on it.
// 2026-10-15: Pinnacle, weather, rest and news signals; opponent-adjusted EPA; two searches a batch.
export const HOUSE_PROMPT_VERSION = "2026-10-15";

export type HouseVariant = {
  id: string;
  /** Stored with each call. Change it whenever the variant's diff changes. */
  prompt_version: string;
  /** Text added to the end of the control system prompt; empty for none. */
  system: string;
  /** Whether the house's record (lib/pickem-feedback.ts) follows the slate. */
  feedback: boolean;
  /** What the variant tests, for the README and the admin table. */
  note: string;
};

/**
 * The variants in play. "control" is the prompt every variant is a diff from
 * and must stay first. Games are dealt to them in turn, so two variants split
 * a slate in half; to stop testing one, delete it here (its calls keep their
 * id and prompt_version in the record).
 */
export const HOUSE_VARIANTS: HouseVariant[] = [
  { id: "control", prompt_version: HOUSE_PROMPT_VERSION, system: "", feedback: false, note: "The house prompt with no record shown." },
  {
    id: "feedback-on",
    prompt_version: `${HOUSE_PROMPT_VERSION}+feedback`,
    system: "",
    feedback: true,
    note: "Control plus the house's own record and last week's calls after the slate.",
  },
];

export function houseVariant(id: string | null | undefined, variants: HouseVariant[] = HOUSE_VARIANTS): HouseVariant | undefined {
  return variants.find((v) => v.id === id);
}

/** FNV-1a, 32-bit: a stable, well-spread order that needs no crypto. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Which variant picks each game of a league-week. The week's games are put in
 * an order seeded by (league, week) and dealt to the variants in turn. A game
 * already picked under a variant still in play keeps it, so a forced re-pick
 * or the gap-filling run asks the same question of the same game. The order
 * is over every game of the week, started ones included, so the deal does not
 * shift as games kick off.
 *
 * weekGames: every game of the week with the variant its current call was
 * made under (null when it has none or predates the experiment).
 */
export function assignVariants(
  league: League,
  week: number,
  weekGames: { id: string; variant: string | null }[],
  variants: HouseVariant[] = HOUSE_VARIANTS
): Map<string, HouseVariant> {
  const seed = `${league}|${week}|`;
  const order = [...weekGames].sort((a, b) => fnv1a(seed + a.id) - fnv1a(seed + b.id) || a.id.localeCompare(b.id));
  const out = new Map<string, HouseVariant>();
  order.forEach((g, i) => out.set(g.id, houseVariant(g.variant, variants) ?? variants[i % variants.length]));
  return out;
}

/** Deal items round-robin into ceil(n / size) batches so the interesting games spread out. */
export function dealBatches<T>(xs: T[], size: number): T[][] {
  const n = Math.ceil(xs.length / size);
  const out: T[][] = Array.from({ length: n }, () => []);
  xs.forEach((x, i) => out[i % n].push(x));
  return out.filter((b) => b.length);
}

/**
 * Batches for a run: each holds one variant's games, dealt within the
 * variant in the order given, and the variants' batches alternate so every
 * variant is in the first wave even when the wave is cut short.
 */
export function dealVariantBatches<T>(
  games: T[],
  variantFor: (g: T) => HouseVariant,
  size: number,
  variants: HouseVariant[] = HOUSE_VARIANTS
): { variant: HouseVariant; games: T[] }[] {
  const per = variants.map((v) => dealBatches(games.filter((g) => variantFor(g).id === v.id), size).map((b) => ({ variant: v, games: b })));
  const out: { variant: HouseVariant; games: T[] }[] = [];
  for (let i = 0; per.some((p) => i < p.length); i++) for (const p of per) if (i < p.length) out.push(p[i]);
  return out;
}
