"use client";

import { useCallback, useEffect, useState } from "react";
import type { Factor, SupabaseClient } from "@supabase/supabase-js";
import { cleanCode, groupSecret, nextFactorName, verifiedTotp } from "@/lib/admin/mfa";
import { buttonClass, inputClass, primaryButtonClass, smallButtonClass } from "./ui";

// "Two-step sign-in" in Settings → Account: add an authenticator app (scan
// the QR code or type the key, then prove it with a first code), see the
// ones already set up, and remove one. Once an authenticator is on the
// account, the sign-in gate asks for its code after the password or magic
// link (admin-gate.tsx).
//
// It talks to Supabase Auth only, and reports in place rather than through
// the admin's toasts, so it has no need of the admin data provider.

// A factor being set up: created on the account but not yet proven.
type Pending = {
  factorId: string;
  qr: string; // an image URL for the QR code
  secret: string; // the same key as text, for typing or a password manager
  uri: string; // otpauth:// link, opens an authenticator on this device
};

type Note = { kind: "ok" | "error"; text: string };

// Supabase hands the QR code over as raw SVG behind a data: prefix. Encode
// it so a "#" in the drawing can't cut the image short.
function qrImageUrl(qr: string): string {
  const svg = qr.replace(/^data:image\/svg\+xml;utf-8,/, "");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function failText(error: { message: string; code?: string }): string {
  if (error.code === "mfa_verification_failed")
    return "That code didn't match. Wait for the app to show a new one and try again.";
  if (error.code === "insufficient_aal")
    return "Sign out and sign back in with a code first, then try again.";
  return error.message;
}

export function TwoStepSection({
  supabase,
  onTurnedOn,
}: {
  supabase: SupabaseClient;
  // Called when the first authenticator is confirmed (the session has just
  // been raised to "signed in with a code").
  onTurnedOn?: () => void;
}) {
  const [factors, setFactors] = useState<Factor[] | null>(null); // null = loading
  const [loadFailed, setLoadFailed] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [removing, setRemoving] = useState<string | null>(null); // factor id awaiting a second click
  const [keyCopied, setKeyCopied] = useState(false);

  const load = useCallback(async (): Promise<Factor[] | null> => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setLoadFailed(error.message);
      return null;
    }
    setLoadFailed("");
    setFactors(data.all);
    return data.all;
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (error) setLoadFailed(error.message);
      else setFactors(data.all);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const devices = verifiedTotp(factors);
  const on = devices.length > 0;

  async function startSetup() {
    setBusy(true);
    setNote(null);
    setRemoving(null);
    // A setup that was started and walked away from leaves a factor that
    // protects nothing and would block reusing its name: clear those first.
    const current = (await load()) ?? [];
    for (const f of current) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const kept = current.filter((f) => f.status === "verified");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: nextFactorName(kept),
      issuer: "Curiouser Records admin",
    });
    setBusy(false);
    if (error) {
      setNote({ kind: "error", text: failText(error) });
      return;
    }
    setCode("");
    setKeyCopied(false);
    setPending({
      factorId: data.id,
      qr: qrImageUrl(data.totp.qr_code),
      secret: data.totp.secret,
      uri: data.totp.uri,
    });
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!pending || code.length !== 6) return;
    setBusy(true);
    setNote(null);
    const wasOn = on;
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: pending.factorId,
      code,
    });
    if (error) {
      setBusy(false);
      setCode("");
      setNote({ kind: "error", text: failText(error) });
      return;
    }
    setPending(null);
    setCode("");
    await load();
    setBusy(false);
    setNote({
      kind: "ok",
      text: wasOn
        ? "Added. Either app's code now works at sign-in."
        : "Two-step sign-in is on. From now on, signing in asks for a code from the app.",
    });
    if (!wasOn) onTurnedOn?.();
  }

  async function cancelSetup() {
    if (!pending) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: pending.factorId });
    setPending(null);
    setCode("");
    setNote(null);
    setBusy(false);
  }

  async function remove(factor: Factor) {
    setBusy(true);
    setNote(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setRemoving(null);
    if (error) {
      setBusy(false);
      setNote({ kind: "error", text: failText(error) });
      return;
    }
    const left = verifiedTotp(await load());
    setBusy(false);
    setNote({
      kind: "ok",
      text: left.length
        ? "Removed. Its codes no longer work."
        : "Removed. Two-step sign-in is off: the password alone signs in again.",
    });
  }

  async function copyKey() {
    if (!pending) return;
    try {
      await navigator.clipboard.writeText(pending.secret);
      setKeyCopied(true);
    } catch {
      // No clipboard access: the key is on screen to select by hand.
    }
  }

  return (
    <div id="two-step" className="mt-8 max-w-2xl scroll-mt-24">
      <h3 className="flex flex-wrap items-center gap-2 text-lg font-medium">
        Two-step sign-in
        {factors ? (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-normal ${
              on
                ? "border-green-400/40 text-green-400"
                : "border-yellow-400/40 text-yellow-400"
            }`}
          >
            {on ? "On" : "Off"}
          </span>
        ) : null}
      </h3>
      <p className="mt-1 text-sm text-neutral-400">
        After your password or magic link, signing in also asks for a 6-digit
        code from an authenticator app (Google Authenticator, 1Password,
        Apple Passwords and the like). A stolen password alone then
        can&rsquo;t open the admin.
      </p>

      {loadFailed ? (
        <p className="mt-3 text-sm text-red-400">
          Couldn&rsquo;t check two-step sign-in: {loadFailed}{" "}
          <button type="button" onClick={() => void load()} className="underline">
            Try again
          </button>
        </p>
      ) : !factors ? (
        <p className="mt-3 text-sm text-neutral-500">Loading…</p>
      ) : (
        <>
          {devices.length ? (
            <ul className="mt-3 flex flex-col gap-2">
              {devices.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                >
                  <span>
                    {f.friendly_name || "Authenticator app"}
                    <span className="text-neutral-500">
                      {" "}
                      · added {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  {removing === f.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-neutral-400">
                        {devices.length === 1
                          ? "This turns two-step sign-in off."
                          : "Its codes will stop working."}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(f)}
                        disabled={busy}
                        className={smallButtonClass}
                      >
                        Yes, remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setRemoving(null)}
                        disabled={busy}
                        className={smallButtonClass}
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRemoving(f.id);
                        setNote(null);
                      }}
                      disabled={busy || !!pending}
                      className={smallButtonClass}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {pending ? (
            <form
              onSubmit={confirmSetup}
              className="mt-3 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <p className="text-sm text-neutral-200">
                <span className="text-neutral-500">1. </span>
                Scan this with your authenticator app, or type the key in.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {/* A data: image made in the browser; next/image has nothing to optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pending.qr}
                  alt="QR code for your authenticator app"
                  width={176}
                  height={176}
                  className="h-44 w-44 shrink-0 rounded-lg bg-white p-2"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                  <span className="text-neutral-400">Setup key</span>
                  <code className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-neutral-100">
                    {groupSecret(pending.secret)}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={copyKey} className={smallButtonClass}>
                      {keyCopied ? "Copied" : "Copy key"}
                    </button>
                    <a href={pending.uri} className={smallButtonClass}>
                      Open in an app on this device
                    </a>
                  </div>
                  <p className="text-neutral-500">
                    Saving the key in your password manager too means a lost
                    phone doesn&rsquo;t lock you out.
                  </p>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-sm text-neutral-200">
                <span>
                  <span className="text-neutral-500">2. </span>
                  Enter the 6-digit code the app shows.
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(cleanCode(e.target.value))}
                  placeholder="123456"
                  aria-label="6-digit code"
                  className={`w-40 tracking-[0.3em] ${inputClass}`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className={primaryButtonClass}
                >
                  {busy ? "Checking…" : on ? "Add this app" : "Turn on two-step sign-in"}
                </button>
                <button type="button" onClick={cancelSetup} disabled={busy} className={buttonClass}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={startSetup} disabled={busy} className={buttonClass}>
                {busy ? "One moment…" : on ? "Add another app or device" : "Set up two-step sign-in"}
              </button>
              {on && devices.length === 1 ? (
                <span className="text-sm text-neutral-500">
                  A second one is a spare key if the first is lost.
                </span>
              ) : null}
            </div>
          )}

          {note ? (
            <p
              role="status"
              className={`mt-3 text-sm ${note.kind === "ok" ? "text-green-400" : "text-red-400"}`}
            >
              {note.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
