"use client";

import { useEffect, useState } from "react";
import { useAdmin } from "./admin-provider";
import { buttonClass, inputClass } from "./ui";
import {
  NOTE_MAX,
  SHIPPING_PAUSE_KEY,
  activeShippingPause,
  formatShipDay,
  isIsoDay,
  parseShippingPause,
  shippingPauseSentence,
  type ShippingPause,
} from "@/lib/shipping-pause";

// YYYY-MM-DD plus one day (UTC noon so no zone can shift the date).
function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const labelClass = "flex flex-col gap-1 text-sm text-neutral-400";

export function SettingsPage() {
  const { supabase, pushToast } = useAdmin();
  const [newPassword, setNewPassword] = useState("");
  const [pwStatus, setPwStatus] = useState("");

  // ── Away / shipping pause ─────────────────────────────────────────────
  // Three dates and a note, saved as JSON in settings.shipping_pause (see
  // lib/shipping-pause.ts). The row is seeded by the 20261106 migration;
  // the admin policy only allows UPDATE, so a missing row is reported
  // rather than inserted.
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [shipsOn, setShipsOn] = useState("");
  const [note, setNote] = useState("");
  const [pauseLoad, setPauseLoad] = useState<"loading" | "ready" | "missing">("loading");
  const [savedPause, setSavedPause] = useState<ShippingPause | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("value")
        .eq("key", SHIPPING_PAUSE_KEY)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setPauseLoad("missing");
        return;
      }
      const p = parseShippingPause((data as { value: string | null }).value);
      setSavedPause(p);
      if (p) {
        setFrom(p.from);
        setUntil(p.until);
        setShipsOn(p.shipsOn);
        setNote(p.note);
      }
      setPauseLoad("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // "Orders ship on" defaults to the day after you're back.
  const effectiveShipsOn = shipsOn || (isIsoDay(until) ? nextDay(until) : "");
  const draft = parseShippingPause(
    JSON.stringify({ from, until, shipsOn: effectiveShipsOn, note })
  );
  const draftProblem =
    !from && !until
      ? ""
      : !isIsoDay(from) || !isIsoDay(until)
        ? "Pick both the first and last day away."
        : from > until
          ? "“Last day away” can’t be before “Away from”."
          : effectiveShipsOn <= until
            ? "Orders have to ship after you’re back."
            : "";
  const draftOver = draft ? !activeShippingPause(draft) : false;
  const savedActive = savedPause ? activeShippingPause(savedPause) : null;

  async function writePause(value: string) {
    setPauseBusy(true);
    const { data, error } = await supabase
      .from("settings")
      .update({ value })
      .eq("key", SHIPPING_PAUSE_KEY)
      .select("key");
    setPauseBusy(false);
    if (error || !data?.length) {
      pushToast(
        "error",
        error?.message ?? "Couldn't save — the shipping_pause settings row is missing."
      );
      return false;
    }
    return true;
  }

  async function savePause() {
    if (!draft) {
      pushToast("error", draftProblem || "Fill in the dates first.");
      return;
    }
    if (await writePause(JSON.stringify(draft))) {
      setSavedPause(draft);
      setShipsOn(draft.shipsOn);
      pushToast(
        "success",
        draftOver
          ? "Saved, but those dates are already past — nothing will show."
          : "Away notice saved — the shop shows it within a minute."
      );
    }
  }

  async function clearPause() {
    if (await writePause("")) {
      setSavedPause(null);
      setFrom("");
      setUntil("");
      setShipsOn("");
      setNote("");
      pushToast("success", "Away notice cleared.");
    }
  }

  async function savePassword() {
    setPwStatus("");
    if (newPassword.length < 8) {
      setPwStatus("Password must be at least 8 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwStatus(
      error
        ? error.message
        : "Password saved — next time you can sign in with it directly."
    );
    if (!error) setNewPassword("");
  }

  return (
    <>
      <h1 className="mt-6 text-3xl font-semibold">Settings</h1>

      <h2 className="mt-10 text-xl font-medium">Away / shipping pause</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Tell buyers when nothing ships. The shop stays open: a banner shows on
        every page, the Request-to-buy dialog repeats it, and the confirmation
        email carries it. It disappears by itself the day after you&rsquo;re
        back.
      </p>
      {pauseLoad === "missing" ? (
        <p className="mt-3 text-sm text-red-400">
          The <code>shipping_pause</code> settings row is missing — run
          supabase/migrations/20261106_shipping_pause.sql first.
        </p>
      ) : (
        <div className="mt-3 flex max-w-2xl flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>
              Away from
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={inputClass}
                disabled={pauseLoad !== "ready"}
              />
            </label>
            <label className={labelClass}>
              Last day away
              <input
                type="date"
                value={until}
                min={from || undefined}
                onChange={(e) => setUntil(e.target.value)}
                className={inputClass}
                disabled={pauseLoad !== "ready"}
              />
            </label>
            <label className={labelClass}>
              Orders ship on
              <input
                type="date"
                value={shipsOn}
                min={isIsoDay(until) ? nextDay(until) : undefined}
                placeholder={effectiveShipsOn}
                onChange={(e) => setShipsOn(e.target.value)}
                className={inputClass}
                disabled={pauseLoad !== "ready"}
              />
            </label>
          </div>
          <label className={labelClass}>
            Extra line (optional)
            <input
              type="text"
              value={note}
              maxLength={NOTE_MAX}
              placeholder="e.g. Happy to answer questions in the meantime."
              onChange={(e) => setNote(e.target.value)}
              className={inputClass}
              disabled={pauseLoad !== "ready"}
            />
          </label>
          {draft ? (
            <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-neutral-200">
              <span className="text-neutral-500">Buyers will read: </span>
              {shippingPauseSentence(draft)}
              {!shipsOn ? (
                <span className="text-neutral-500">
                  {" "}
                  (ship day defaults to {formatShipDay(effectiveShipsOn)})
                </span>
              ) : null}
            </p>
          ) : draftProblem ? (
            <p className="text-sm text-red-400">{draftProblem}</p>
          ) : null}
          {draft && draftOver ? (
            <p className="text-sm text-yellow-400">
              Those dates are already past, so nothing will show.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={savePause}
              className={buttonClass}
              disabled={pauseBusy || pauseLoad !== "ready" || !draft}
            >
              {pauseBusy ? "Saving…" : "Save away notice"}
            </button>
            <button
              type="button"
              onClick={clearPause}
              className={buttonClass}
              disabled={pauseBusy || pauseLoad !== "ready" || (!savedPause && !from && !until)}
            >
              Clear
            </button>
            <span className="text-sm text-neutral-500">
              {pauseLoad === "loading"
                ? "Loading…"
                : savedActive
                  ? `Showing now: away ${savedActive.from} to ${savedActive.until}.`
                  : savedPause
                    ? "A past notice is saved; nothing is showing."
                    : "Nothing is showing."}
            </span>
          </div>
        </div>
      )}

      <h2 className="mt-10 text-xl font-medium">Account</h2>
      <p className="mt-1 text-sm text-neutral-400">
        Set a password to sign in directly — magic-link emails are rate-limited
        by Supabase.
      </p>
      <div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
        <input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (8+ characters)"
          className={`flex-1 ${inputClass}`}
        />
        <button type="button" onClick={savePassword} className={buttonClass}>
          Save password
        </button>
      </div>
      {pwStatus ? (
        <p
          className={`mt-2 text-sm ${
            pwStatus.startsWith("Password saved")
              ? "text-green-400"
              : "text-red-400"
          }`}
        >
          {pwStatus}
        </p>
      ) : null}
    </>
  );
}
