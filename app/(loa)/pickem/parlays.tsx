"use client";

// The house's parlays for the week: one per leg count, two through seven,
// computed from the house picks. Tailable until the first leg kicks off.
import { fmtPrice, gradePick, winUnits, type PickemGame, type PickemParlay } from "@/lib/pickem";
import { usePickemActions } from "./pickem-context";
import HouseBadge from "./house-badge";
import ResultTag from "./result-tag";
import TeamLogo from "./team-logo";

type Props = { parlays: PickemParlay[]; games: PickemGame[]; tails: Set<number>; now: number };

export default function Parlays({ parlays, games, tails, now }: Props) {
  const { canPick, toggleTail } = usePickemActions();
  return (
    <section className="mt-12">
      <h2 className="text-lg font-semibold text-white">House parlays</h2>
      <p className="mt-1 max-w-2xl text-sm text-neutral-400">
        One ticket per leg count, two through seven, built from the legs with the most edge over the price. Tailing
        one risks a unit at the combined price. A push on any leg pushes the ticket.
      </p>
      {parlays.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">House parlays post Thursday around noon Central, once every game has house picks.</p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {parlays.map((p) => {
            const locked = new Date(p.locks_at).getTime() <= now;
            const on = tails.has(p.id);
            return (
              <div key={p.id} className="flex flex-col rounded-md border border-white/10 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-medium text-white">{p.name}</h3>
                  <span className="text-sm font-semibold tabular-nums text-orange-200">{fmtPrice(p.american_odds)}</span>
                </div>
                <ul className="mt-3 text-sm text-neutral-100">
                  {p.legs.map((l, i) => {
                    const g = games.find((x) => x.id === l.game_id);
                    const res = g ? gradePick(l.market, l.selection, l.line, g.home_score, g.away_score) : null;
                    return (
                      <li key={i} className="flex items-center justify-between gap-3 border-t border-white/10 py-1.5 first:border-t-0">
                        <span className="inline-flex items-center gap-1.5">
                          {g && l.market !== "total" ? (
                            <TeamLogo league={g.league} name={l.selection === "home" ? g.home_team : g.away_team} size="sm" />
                          ) : null}
                          {l.label}
                          {l.confidence != null ? <HouseBadge value={l.confidence} why={g?.house?.[l.market]?.why} label={l.label} /> : null}
                        </span>
                        <span className="flex items-center gap-2 tabular-nums text-neutral-400">
                          {fmtPrice(l.price)} <ResultTag result={res} provisional={!!g && !g.completed} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-sm leading-6 text-neutral-300">{p.note}</p>
                <p className="mt-2 text-xs tabular-nums text-neutral-500">
                  {p.hit_probability != null
                    ? `House puts it at ${p.hit_probability < 0.1 ? (p.hit_probability * 100).toFixed(1) : Math.round(p.hit_probability * 100)}% to hit`
                    : `Confidence ${p.confidence ?? "—"}/10`}
                  {" "}· 1 unit returns {(1 + winUnits(p.american_odds)).toFixed(2)}
                </p>
                <button
                  type="button"
                  disabled={!canPick || locked}
                  onClick={() => toggleTail(p)}
                  className={`mt-3 h-9 rounded-md border text-sm font-medium transition disabled:cursor-default disabled:opacity-60 ${
                    on ? "border-orange-400 bg-orange-500/15 text-white" : "border-white/15 text-neutral-100 enabled:hover:border-white/40"
                  }`}
                >
                  {locked ? "Locked" : on ? "Tailing" : "Tail this parlay"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
