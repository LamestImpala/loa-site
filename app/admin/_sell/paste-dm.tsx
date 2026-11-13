"use client";

import { useMemo, useState } from "react";
import { makeRefCode } from "@/lib/records";
import { itemSubtitle } from "@/lib/items";
import type { OrderRequest, ShopMessage } from "@/lib/supabase";
import {
  extractRefCode,
  matchLines,
  parseOrderText,
  recordFlags,
  type LineMatch,
} from "@/lib/order-parse";
import { bodyText } from "@/lib/admin/messages";
import { useAdmin } from "../_shell/admin-provider";
import { buttonClass, inputClass } from "../_shell/ui";
import type { Desk } from "./use-desk";

// Paste a DM: one way to fill the sale desk. The buyer's message — even
// edited — is matched against the listings for review, and nothing goes
// on the desk until it's confirmed. An email with no saved request is
// read the same way (Conversations hands its body over).

type ParseResult = {
  ref: string | null;
  refRequest: OrderRequest | null;
  rows: LineMatch[];
  choices: Record<number, number>; // row index -> chosen record id
};

// The paste box's state, owned by the Sell page so a message card can
// fill it from the other column.
export function usePasteDm() {
  const { records, pushToast } = useAdmin();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);

  function reveal() {
    setOpen(true);
    setTimeout(() => {
      document
        .getElementById("paste-dm")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }

  // Read an email's body like a pasted DM.
  function parseMessage(m: ShopMessage) {
    const body = bodyText(m);
    setText(body);
    const rows = matchLines(parseOrderText(body), records);
    setResult({ ref: m.ref_code, refRequest: null, rows, choices: {} });
    if (rows.length === 0) {
      pushToast(
        "info",
        "No record lines found in this message — add the records with the desk's search."
      );
    }
    reveal();
  }

  function clear() {
    setText("");
    setResult(null);
  }

  return { open, setOpen, text, setText, result, setResult, parseMessage, clear, reveal };
}

export type PasteDmState = ReturnType<typeof usePasteDm>;

export function PasteDm({ paste, desk }: { paste: PasteDmState; desk: Desk }) {
  const {
    supabase,
    records,
    byId,
    orderRequests,
    setOrderRequests,
    setSaleBuyer,
    setSaleEmail,
    setSaleChannel,
  } = useAdmin();
  const { text, setText, result, setResult } = paste;
  const [saveChecked, setSaveChecked] = useState(true);

  async function parse() {
    if (!text.trim()) return;
    const ref = extractRefCode(text);
    let refRequest = ref
      ? (orderRequests.find((r) => r.ref_code === ref) ?? null)
      : null;
    if (ref && !refRequest) {
      // Not in the open list — maybe already closed or older than the
      // load window.
      const { data } = await supabase
        .from("order_requests")
        .select("*")
        .eq("ref_code", ref)
        .maybeSingle();
      refRequest = (data as OrderRequest | null) ?? null;
    }
    const rows = matchLines(parseOrderText(text), records);
    setResult({ ref, refRequest, rows, choices: {} });
  }

  // Records the review would put on the sale desk right now.
  const parsedIds = useMemo(() => {
    if (!result) return [] as number[];
    const ids: number[] = [];
    result.rows.forEach((row, i) => {
      if (row.status === "matched" && row.match && !row.match.sold) {
        ids.push(row.match.id);
      } else if (row.status === "ambiguous") {
        const chosen = result.choices[i];
        if (chosen !== undefined && !byId.get(chosen)?.sold) ids.push(chosen);
      }
    });
    return [...new Set(ids)];
  }, [result, byId]);

  // Track a paste-parsed order under Conversations like any buyer-submitted
  // request. The insert goes through the same validation trigger, so ids
  // are revalidated and totals recomputed server-side.
  async function saveParsedRequest(ids: number[]) {
    const { data, error } = await supabase
      .from("order_requests")
      .insert({ ref_code: makeRefCode(), record_ids: ids })
      .select()
      .single();
    if (error || !data) {
      console.warn("could not save parsed order as request:", error?.message);
      return;
    }
    // It's going straight onto the sale desk, so it starts out loaded.
    const { error: statusError } = await supabase
      .from("order_requests")
      .update({ status: "loaded", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    const saved = {
      ...(data as OrderRequest),
      status: statusError ? "new" : "loaded",
    } as OrderRequest;
    setOrderRequests((prev) => [saved, ...prev]);
  }

  async function applyParsed() {
    if (parsedIds.length === 0) return;
    if (!(await desk.putOnDesk(parsedIds))) return;
    const matched = result?.refRequest;
    const typedBuyer =
      matched?.channel === "email"
        ? matched.buyer_name || matched.buyer_email
        : matched?.buyer_username;
    if (typedBuyer) setSaleBuyer((prev) => (prev.trim() ? prev : typedBuyer));
    if (matched?.channel === "email" && matched.buyer_email) {
      const email = matched.buyer_email;
      setSaleEmail((prev) => (prev.trim() ? prev : email));
      setSaleChannel("email");
    }
    // Don't double-track: a DM whose ref matched a saved request is already
    // under Conversations.
    if (saveChecked && !result?.refRequest) {
      void saveParsedRequest(parsedIds);
    }
    paste.clear();
    paste.setOpen(false);
  }

  async function loadMatchedRequest(req: OrderRequest) {
    if (await desk.loadRequest(req)) {
      paste.clear();
      paste.setOpen(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-neutral-400">
        Paste the buyer&rsquo;s message — even edited — and it&rsquo;s matched
        against your listings. Nothing goes on the desk until you confirm.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={"1. Artist — Title — Media: M / Sleeve: NM — $63\n2. …"}
        aria-label="The buyer's message"
        className={`mt-2 w-full ${inputClass}`}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!text.trim()}
          onClick={parse}
        >
          Match records
        </button>
        {text || result ? (
          <button type="button" className={buttonClass} onClick={paste.clear}>
            Clear
          </button>
        ) : null}
      </div>
      {result ? (
        <div className="mt-3 space-y-2 text-sm">
          {result.refRequest ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3">
              <span className="text-emerald-300">
                Exact match: saved request{" "}
                <span className="font-mono">{result.refRequest.ref_code}</span> (
                {result.refRequest.record_ids.length} records, $
                {result.refRequest.total}
                {result.refRequest.channel === "email"
                  ? ` · ${result.refRequest.buyer_name ?? ""} ${result.refRequest.buyer_email ?? ""}`.trimEnd()
                  : result.refRequest.buyer_username
                    ? ` · u/${result.refRequest.buyer_username}`
                    : ""}
                {result.refRequest.status !== "new" &&
                result.refRequest.status !== "loaded"
                  ? ` · ${result.refRequest.status}`
                  : ""}
                )
              </span>
              <button
                type="button"
                className={buttonClass}
                onClick={() => loadMatchedRequest(result.refRequest!)}
              >
                Load request
              </button>
            </div>
          ) : result.ref ? (
            <p className="text-amber-400">
              Ref code {result.ref} found, but no saved request matches it —
              using the lines below.
            </p>
          ) : null}
          {result.rows.length === 0 ? (
            <p className="text-neutral-400">No order lines found in the text.</p>
          ) : (
            result.rows.map((row, i) => {
              if (row.status === "matched" && row.match) {
                const excluded = row.match.sold;
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2"
                  >
                    <span className="text-emerald-400">✓</span> {row.match.artist} —{" "}
                    {row.match.title} (${row.match.price})
                    {row.flags && row.flags.length > 0 ? (
                      <span className="text-amber-400">
                        {" "}
                        · {row.flags.join(" · ")}
                        {excluded ? " — will not be added" : ""}
                      </span>
                    ) : null}
                  </div>
                );
              }
              if (row.status === "ambiguous") {
                return (
                  <div
                    key={i}
                    className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2"
                  >
                    <p className="text-amber-300">
                      Which record is &ldquo;{row.parsed.raw}&rdquo;?
                    </p>
                    <div className="mt-2 space-y-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`ambiguous-${i}`}
                          className="admin-radio"
                          checked={result.choices[i] === undefined}
                          onChange={() =>
                            setResult((prev) => {
                              if (!prev) return prev;
                              const choices = { ...prev.choices };
                              delete choices[i];
                              return { ...prev, choices };
                            })
                          }
                        />
                        <span className="text-neutral-400">None of these</span>
                      </label>
                      {(row.candidates ?? []).map((c) => {
                        const flags = recordFlags(c, row.parsed.price);
                        return (
                          <label key={c.id} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`ambiguous-${i}`}
                              className="admin-radio"
                              checked={result.choices[i] === c.id}
                              onChange={() =>
                                setResult((prev) =>
                                  prev
                                    ? { ...prev, choices: { ...prev.choices, [i]: c.id } }
                                    : prev
                                )
                              }
                            />
                            <span>
                              {c.artist} — {c.title}{" "}
                              <span className="text-neutral-500">{itemSubtitle(c)}</span> — $
                              {c.price}
                              {flags.length > 0 ? (
                                <span className="text-amber-400"> · {flags.join(" · ")}</span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-red-300"
                >
                  No match — add it with the search above:{" "}
                  <span className="text-red-200">{row.parsed.raw}</span>
                </div>
              );
            })
          )}
          {result.rows.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={buttonClass}
                disabled={parsedIds.length === 0}
                onClick={applyParsed}
              >
                Put {parsedIds.length} on the desk
              </button>
              {!result.refRequest ? (
                <label className="flex items-center gap-2 text-sm text-neutral-400">
                  <input
                    type="checkbox"
                    checked={saveChecked}
                    onChange={(e) => setSaveChecked(e.target.checked)}
                    className="admin-checkbox"
                  />
                  Also save as a request
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
