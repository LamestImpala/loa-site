"use client";

// Import a bet slip: pick a screenshot, Claude reads it, the player checks
// the reading, and only then is anything saved. The screenshot is shrunk in
// the browser, sent once, and kept nowhere.
import { useRef, useState } from "react";
import { fmtPrice, fmtSpread } from "@/lib/pickem";
import { fmtMoney, importable, type ReviewBet, type ReviewLeg, type SlipReview } from "@/lib/pickem-slip";
import { pickKey, type PickemSession } from "./use-pickem-session";

// The longest edge Claude reads at full detail; anything larger only costs upload time.
const MAX_EDGE = 1568;

type Stage =
  | { at: "idle"; note?: string; problems?: string[] }
  | { at: "reading" }
  | { at: "review"; review: SlipReview }
  | { at: "saving"; review: SlipReview };

/** Downsize to a JPEG and return it as base64, so the upload stays small whatever the phone produced. */
async function toJpegBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

function betTitle(bet: ReviewBet): string {
  return bet.kind === "parlay" ? `${bet.legs.length}-leg parlay` : "Straight bet";
}

export default function SlipImport({ auth }: { auth: PickemSession }) {
  const [stage, setStage] = useState<Stage>({ at: "idle" });
  const input = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !auth.session) return;
    setStage({ at: "reading" });
    try {
      const image = await toJpegBase64(file);
      const res = await fetch("/api/pickem/slip", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.session.access_token}` },
        body: JSON.stringify({ image, media_type: "image/jpeg" }),
      });
      const body = await res.json();
      if (!res.ok) return setStage({ at: "idle", problems: [body.error ?? "Could not read that screenshot."] });
      const review = body as SlipReview;
      if (review.bets.length === 0) return setStage({ at: "idle", problems: ["No bets found in that screenshot."] });
      setStage({ at: "review", review });
    } catch {
      setStage({ at: "idle", problems: ["Could not read that screenshot."] });
    }
  }

  async function save(review: SlipReview) {
    setStage({ at: "saving", review });
    const problems = await auth.importSlip(review);
    const legs = review.bets.flatMap((b) => b.legs).filter((l) => l.status === "ok").length;
    setStage({ at: "idle", note: `Imported ${legs} pick${legs === 1 ? "" : "s"}.`, problems });
  }

  const review = stage.at === "review" || stage.at === "saving" ? stage.review : null;
  const anything = review?.bets.some(importable) ?? false;

  return (
    <div className="border-b border-white/10 py-3 text-sm">
      <input ref={input} type="file" accept="image/*" onChange={onFile} className="sr-only" aria-label="Bet slip screenshot" />
      {!review ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            disabled={stage.at === "reading"}
            onClick={() => input.current?.click()}
            className="h-9 rounded-md border border-white/15 px-3 font-medium text-neutral-100 transition enabled:hover:border-white/40 disabled:opacity-60"
          >
            {stage.at === "reading" ? "Reading your slip…" : "Import a bet slip"}
          </button>
          <p className="text-neutral-400" aria-live="polite">
            {stage.at === "idle" && stage.note ? stage.note : "Upload a screenshot from your sportsbook. It is read once and not kept."}
          </p>
          {stage.at === "idle" && stage.problems?.length ? (
            <ul className="w-full text-red-300">
              {stage.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div>
          <h2 className="font-medium text-white">Check your slip{review.book ? ` from ${review.book}` : ""}</h2>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            {review.bets.map((bet, i) => (
              <div key={i} className="rounded-md border border-white/10 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium text-white">
                    {betTitle(bet)}
                    {bet.stake != null ? (
                      <span className="font-normal text-neutral-400">
                        {" "}· {fmtMoney(bet.stake)}
                        {bet.payout != null ? ` pays ${fmtMoney(bet.payout)}` : ""}
                      </span>
                    ) : null}
                  </h3>
                  {bet.kind === "parlay" && bet.american_odds != null ? (
                    <span className="font-semibold tabular-nums text-orange-200">{fmtPrice(bet.american_odds)}</span>
                  ) : null}
                </div>
                <ul className="mt-2">
                  {bet.legs.map((leg, j) => (
                    <Leg key={j} leg={leg} replaces={leg.status === "ok" && leg.game_id != null && auth.picks.has(pickKey(leg.game_id, leg.market))} />
                  ))}
                </ul>
                {bet.kind === "parlay" && !bet.ticket && importable(bet) ? (
                  <p className="mt-2 text-neutral-400">Not every leg can be imported, so this is saved as picks only, not as a parlay ticket.</p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!anything || stage.at === "saving"}
              onClick={() => save(review)}
              className="h-9 rounded-md bg-orange-500 px-4 font-medium text-white transition enabled:hover:bg-orange-400 disabled:opacity-60"
            >
              {stage.at === "saving" ? "Saving…" : "Save these picks"}
            </button>
            <button
              type="button"
              disabled={stage.at === "saving"}
              onClick={() => setStage({ at: "idle" })}
              className="h-9 rounded-md border border-white/15 px-3 text-neutral-100 transition enabled:hover:border-white/40"
            >
              Cancel
            </button>
            {!anything ? <p className="text-neutral-400">Nothing on this slip can be imported.</p> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Leg({ leg, replaces }: { leg: ReviewLeg; replaces: boolean }) {
  const ok = leg.status === "ok";
  // The board's number, when the slip's differs from it.
  const board =
    ok && leg.board != null && leg.board !== (leg.market === "ml" ? leg.price : leg.line)
      ? `board ${leg.market === "spread" ? fmtSpread(leg.board) : leg.market === "ml" ? fmtPrice(leg.board) : leg.board}`
      : null;
  return (
    <li className="border-t border-white/10 py-1.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className={ok ? "text-neutral-100" : "text-neutral-500 line-through"}>{leg.label}</span>
        <span className="tabular-nums text-neutral-400">{fmtPrice(leg.price)}</span>
      </div>
      {leg.note || board || replaces ? (
        <p className={`text-xs ${ok ? "text-neutral-500" : "text-amber-300"}`}>
          {leg.note ?? [board, replaces ? "replaces your pick on this game" : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </li>
  );
}
