"use client";

// The week's House Card: the house's strongest plays, ranked, with the lock
// of the week, an upset alert and the game to stay away from. Content, not
// a ticket: readers follow or fade it on the board. Computed here from the
// slate (lib/pickem-house.ts) so it needs no job and no table.
import { useMemo } from "react";
import { fmtPrice, fmtSpread, type League, type PickemGame } from "@/lib/pickem";
import { fmtKickLong, tzLabel } from "@/lib/pickem-board";
import { buildHouseCard, fmtProjection, fmtRecord, HOUSE_CARD_SIZE, type HouseCardTag } from "@/lib/pickem-house";
import ConfidenceBadge from "./confidence-badge";
import ResultTag from "./result-tag";
import TeamLogo from "./team-logo";

type Props = { games: PickemGame[]; league: League; week: number; now: number; tz: string };

const TAG: Record<HouseCardTag, { text: string; cls: string }> = {
  lock: { text: "Lock of the week", cls: "border-emerald-400/70 text-emerald-300" },
  upset: { text: "Upset alert", cls: "border-orange-400/70 text-orange-300" },
};

export default function HouseCard({ games, league, week, now, tz }: Props) {
  const card = useMemo(() => buildHouseCard(games), [games]);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const graded = card.record.wins + card.record.losses + card.record.pushes > 0;
  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}u`;
  const zone = tzLabel(tz, now);

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-white">House Card</h2>
        <p className="text-sm tabular-nums text-neutral-400">
          Week {week}
          {graded ? (
            <>
              {" "}· {fmtRecord(card.record)} ·{" "}
              <span className={card.record.units >= 0 ? "text-emerald-300" : "text-red-300"}>{signed(card.record.units)}</span>
            </>
          ) : (
            " · nothing graded yet"
          )}
        </p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-neutral-400">
        The house&apos;s {HOUSE_CARD_SIZE[league]} strongest plays this week, ranked, at the numbers it took. Follow them on the board or fade them; the record
        counts every call the house is playing, not just the card.
      </p>

      {!card.posted ? (
        <p className="mt-4 text-sm text-neutral-400">The card posts Thursday around noon Central, once the house has made its calls.</p>
      ) : card.plays.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">The house passes on every game this week. Rare, but it happens.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/10 border-y border-white/10">
          {card.plays.map((p, i) => {
            const g = byId.get(p.game_id);
            const team = p.market === "total" ? null : p.selection === "home" ? g?.home_team : g?.away_team;
            return (
              <li key={`${p.game_id}:${p.market}`} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-2.5 text-sm">
                <span className="pt-0.5 tabular-nums text-neutral-500">{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {g && team ? <TeamLogo league={g.league} name={team} size="sm" /> : null}
                    <span className="font-medium text-white">{p.label}</span>
                    <ConfidenceBadge value={p.confidence} size="md" />
                    <span className="tabular-nums text-neutral-400">
                      {p.stake}u · {fmtPrice(p.price)}
                    </span>
                    {p.tags.map((t) => (
                      <span key={t} className={`rounded-sm border px-1.5 text-[10px] font-semibold uppercase tracking-wide ${TAG[t].cls}`}>
                        {TAG[t].text}
                      </span>
                    ))}
                    <span className="ml-auto flex items-center gap-2 text-xs tabular-nums text-neutral-500">
                      {p.completed ? "Final" : `${fmtKickLong(p.kickoff, tz)} ${zone}`}
                      <ResultTag result={p.result} provisional={!p.completed} />
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-neutral-400">
                    {p.why}
                    {g?.house?.projection ? (
                      <span className="tabular-nums text-neutral-500">
                        {" "}Projected {fmtProjection(g, g.house.projection)}
                        {g.home_score != null && g.away_score != null ? `; ${g.completed ? "final" : "now"} ${g.home_score}-${g.away_score}.` : "."}
                      </span>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
          {card.stayAway ? (
            <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-2.5 text-sm">
              <span aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-sm border border-white/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-300">Stay away</span>
                  <span className="font-medium text-white">
                    {card.stayAway.away} @ {card.stayAway.home}
                  </span>
                  <span className="tabular-nums text-neutral-400">
                    {card.stayAway.home} {fmtSpread(card.stayAway.spread_home)}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-neutral-500">
                    {fmtKickLong(card.stayAway.kickoff, tz)} {zone}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-neutral-400">The house passes on all three ways. {card.stayAway.why}</p>
              </div>
            </li>
          ) : null}
        </ol>
      )}
    </section>
  );
}
