"use client";

// One game on the board: two lines (away, home), three markets across.
// Memoised so the 30-second clock only re-renders rows whose lock flips.
import { memo } from "react";
import { displayTeam, fmtPrice, fmtSpread, gradePick, type League, type PickemGame, type PickemPick } from "@/lib/pickem";
import { conferenceOf, conferenceTag } from "@/lib/pickem-conferences";
import { bookCode, fmtKick } from "@/lib/pickem-board";
import PickButton from "./pick-button";
import ConfidenceBadge from "./confidence-badge";

type Props = {
  game: PickemGame;
  locked: boolean;
  tz: string;
  spreadPick?: PickemPick;
  totalPick?: PickemPick;
  mlPick?: PickemPick;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
};

function move(open: number | null, now: number | null, fmt: (v: number) => string) {
  if (open == null || now == null || open === now) return undefined;
  return { dir: now > open ? ("up" as const) : ("down" as const), opened: fmt(open) };
}

function Team({ league, name, score, winner }: { league: League; name: string; score: number | null; winner: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 self-center">
      <span className={`truncate text-[13px] lg:text-sm ${winner ? "font-semibold text-white" : "text-neutral-100"}`}>{displayTeam(league, name)}</span>
      {league === "ncaaf" ? <span className="shrink-0 text-[10px] text-neutral-500">{conferenceTag(conferenceOf(name))}</span> : null}
      {score != null ? <span className="ml-auto shrink-0 pr-1 text-[13px] tabular-nums text-neutral-300">{score}</span> : null}
    </div>
  );
}

function GameRow({ game: g, locked, tz, spreadPick, totalPick, mlPick, expanded, onToggleExpand }: Props) {
  const home = displayTeam(g.league, g.home_team);
  const away = displayTeam(g.league, g.away_team);
  const spreadAway = g.spread_home == null ? null : -g.spread_home;
  const hasScore = g.home_score != null && g.away_score != null;
  const status = g.completed ? "Final" : locked ? "Live" : fmtKick(g.commence_time, tz);
  const grade = (p: PickemPick | undefined) => (p ? gradePick(p.market, p.selection, p.line, g.home_score, g.away_score) : null);
  const spreadRes = grade(spreadPick);
  const totalRes = grade(totalPick);
  const mlRes = grade(mlPick);
  const h = g.house;

  const showHouse = () => onToggleExpand(g.id);
  const toggle = (
    <button
      type="button"
      onClick={() => onToggleExpand(g.id)}
      aria-expanded={expanded}
      className="text-[11px] text-neutral-400 underline-offset-2 hover:text-white hover:underline"
    >
      {expanded ? "less" : "lines & house"}
    </button>
  );

  return (
    <li
      className="border-t border-white/10 py-2 lg:grid lg:grid-cols-[4.5rem_minmax(0,1fr)_repeat(3,10.5rem)] lg:items-center lg:gap-x-3"
      aria-label={`${away} at ${home}, ${status}`}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums text-neutral-400 lg:hidden">
        <span className={locked && !g.completed ? "text-orange-200" : undefined}>{status}</span>
        {toggle}
      </div>
      <div className="hidden lg:row-span-2 lg:block lg:self-center">
        <div className={`text-[13px] tabular-nums ${locked && !g.completed ? "text-orange-200" : "text-neutral-300"}`}>{status}</div>
        {toggle}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,4.25rem)] gap-x-1.5 gap-y-1 lg:contents">
        <Team league={g.league} name={g.away_team} score={g.away_score} winner={hasScore && g.away_score! > g.home_score!} />
        <PickButton
          game={g} market="spread" selection="away" locked={locked}
          main={fmtSpread(spreadAway)} sub={fmtPrice(g.best.spread_away?.price)}
          book={bookCode(g.best.spread_away?.book)} bookTitle={g.best.spread_away?.book}
          moved={move(g.open_spread_home == null ? null : -g.open_spread_home, spreadAway, fmtSpread)}
          house={h?.spread.pick === "away" ? h.spread.confidence : undefined} why={h?.spread.why} onShowHouse={showHouse}
          result={spreadPick?.selection === "away" ? spreadRes : null}
          on={spreadPick?.selection === "away"} label={`${away} ${fmtSpread(spreadAway)}`}
        />
        <PickButton
          game={g} market="total" selection="over" locked={locked}
          main={`O ${g.total ?? "—"}`} sub={fmtPrice(g.best.over?.price)}
          book={bookCode(g.best.over?.book)} bookTitle={g.best.over?.book}
          moved={move(g.open_total, g.total, (v) => `${v}`)}
          house={h?.total.pick === "over" ? h.total.confidence : undefined} why={h?.total.why} onShowHouse={showHouse}
          result={totalPick?.selection === "over" ? totalRes : null}
          on={totalPick?.selection === "over"} label={`Over ${g.total ?? ""}`}
        />
        <PickButton
          game={g} market="ml" selection="away" locked={locked}
          main={fmtPrice(g.ml_away)} sub={g.best.ml_away ? fmtPrice(g.best.ml_away.price) : undefined}
          book={bookCode(g.best.ml_away?.book)} bookTitle={g.best.ml_away?.book}
          moved={move(g.open_ml_away, g.ml_away, fmtPrice)}
          house={h?.ml.pick === "away" ? h.ml.confidence : undefined} why={h?.ml.why} onShowHouse={showHouse}
          result={mlPick?.selection === "away" ? mlRes : null}
          on={mlPick?.selection === "away"} label={`${away} moneyline ${fmtPrice(g.ml_away)}`}
        />

        <Team league={g.league} name={g.home_team} score={g.home_score} winner={hasScore && g.home_score! > g.away_score!} />
        <PickButton
          game={g} market="spread" selection="home" locked={locked}
          main={fmtSpread(g.spread_home)} sub={fmtPrice(g.best.spread_home?.price)}
          book={bookCode(g.best.spread_home?.book)} bookTitle={g.best.spread_home?.book}
          moved={move(g.open_spread_home, g.spread_home, fmtSpread)}
          house={h?.spread.pick === "home" ? h.spread.confidence : undefined} why={h?.spread.why} onShowHouse={showHouse}
          result={spreadPick?.selection === "home" ? spreadRes : null}
          on={spreadPick?.selection === "home"} label={`${home} ${fmtSpread(g.spread_home)}`}
        />
        <PickButton
          game={g} market="total" selection="under" locked={locked}
          main={`U ${g.total ?? "—"}`} sub={fmtPrice(g.best.under?.price)}
          book={bookCode(g.best.under?.book)} bookTitle={g.best.under?.book}
          moved={move(g.open_total, g.total, (v) => `${v}`)}
          house={h?.total.pick === "under" ? h.total.confidence : undefined} why={h?.total.why} onShowHouse={showHouse}
          result={totalPick?.selection === "under" ? totalRes : null}
          on={totalPick?.selection === "under"} label={`Under ${g.total ?? ""}`}
        />
        <PickButton
          game={g} market="ml" selection="home" locked={locked}
          main={fmtPrice(g.ml_home)} sub={g.best.ml_home ? fmtPrice(g.best.ml_home.price) : undefined}
          book={bookCode(g.best.ml_home?.book)} bookTitle={g.best.ml_home?.book}
          moved={move(g.open_ml_home, g.ml_home, fmtPrice)}
          house={h?.ml.pick === "home" ? h.ml.confidence : undefined} why={h?.ml.why} onShowHouse={showHouse}
          result={mlPick?.selection === "home" ? mlRes : null}
          on={mlPick?.selection === "home"} label={`${home} moneyline ${fmtPrice(g.ml_home)}`}
        />
      </div>

      {expanded ? (
        <div className="mt-2 grid gap-2 border-t border-dashed border-white/10 pt-2 text-xs text-neutral-300 lg:col-span-5 lg:col-start-1">
          <Detail
            label="Spread"
            opened={fmtSpread(g.open_spread_home)} now={fmtSpread(g.spread_home)} numberFor={home}
            best={[
              [away, g.best.spread_away],
              [home, g.best.spread_home],
            ]}
            house={h?.spread} sideName={(s) => (s === "home" ? home : away)}
          />
          <Detail
            label="Total"
            opened={g.open_total == null ? "—" : `${g.open_total}`} now={g.total == null ? "—" : `${g.total}`}
            best={[
              ["Over", g.best.over],
              ["Under", g.best.under],
            ]}
            house={h?.total} sideName={(s) => (s === "over" ? "the over" : "the under")}
          />
          <Detail
            label="Moneyline"
            opened={`${fmtPrice(g.open_ml_away)} / ${fmtPrice(g.open_ml_home)}`} now={`${fmtPrice(g.ml_away)} / ${fmtPrice(g.ml_home)}`}
            best={[
              [away, g.best.ml_away],
              [home, g.best.ml_home],
            ]}
            house={h?.ml} sideName={(s) => (s === "home" ? home : away)}
          />
        </div>
      ) : null}
    </li>
  );
}

type BestLine = { point: number | null; price: number; book: string } | undefined;

function Detail({
  label, opened, now, numberFor, best, house, sideName,
}: {
  label: string;
  opened: string;
  now: string;
  numberFor?: string;
  best: [string, BestLine][];
  house?: { pick: string; confidence: number; why: string };
  sideName: (s: string) => string;
}) {
  return (
    <div className="grid gap-0.5 lg:grid-cols-[6rem_minmax(0,1fr)]">
      <div className="text-neutral-500">{label}</div>
      <div className="grid gap-0.5">
        <div className="tabular-nums">
          {opened === now ? (
            <span className="text-neutral-400">no move{numberFor ? ` (${numberFor} ${now})` : ""}</span>
          ) : (
            <>
              <span className="text-neutral-400">opened</span> {opened}
              {numberFor ? <span className="text-neutral-500"> ({numberFor})</span> : null}
              <span className="text-neutral-400">, now</span> <span className="text-orange-200">{now}</span>
            </>
          )}
          <span className="text-neutral-400"> · best</span>{" "}
          {best.map(([side, b], i) => (
            <span key={side}>
              {i ? ", " : ""}
              {side} {b ? `${fmtPrice(b.price)} ${b.book}` : "—"}
            </span>
          ))}
        </div>
        {house ? (
          <div>
            <span className="inline-flex items-center gap-1.5 text-orange-300">
              House likes {sideName(house.pick)} <ConfidenceBadge value={house.confidence} size="md" />
            </span>{" "}
            <span className="text-neutral-300">{house.why}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(GameRow);
