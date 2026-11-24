"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Factor, Session, SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, getBrowserSupabase } from "@/lib/supabase";
import { cleanCode, tokenAal, twoStepFor, verifiedTotp } from "@/lib/admin/mfa";
import { TwoStepSection } from "./_shell/two-step";
import { buttonClass, inputClass, primaryButtonClass } from "./_shell/ui";

// Client-side sign-in gate shared by every /admin page. It only decides what
// to render — RLS and the per-route email checks are what actually protect
// the data — so pages under the gate can assume a signed-in admin session.
//
// Two-step sign-in: a password or magic-link session is only half signed
// in. The gate asks for the 6-digit code from the owner's authenticator
// app and renders the admin only after Supabase has raised the session to
// "aal2" (lib/admin/mfa.ts) — the level the admin routes (lib/job-auth.ts)
// and the database policies insist on. An account with no authenticator
// yet is walked through setting one up instead.

type AdminSession = { supabase: SupabaseClient; session: Session };

// The account's authenticators as the auth server last reported them, kept
// per user so an hourly token refresh re-checks quietly instead of
// blanking the admin.
type FactorCheck = { userId: string; factors: Factor[] } | { userId: string; error: string };

const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession must be used inside <AdminGate>");
  return ctx;
}

export function AdminGate({ children }: { children: ReactNode }) {
  const supabase = getBrowserSupabase();

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [factorCheck, setFactorCheck] = useState<FactorCheck | null>(null);
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setFactorCheck(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const token = session?.access_token ?? null;
  const userId = session?.user.id ?? null;
  const isAdmin = session?.user.email === ADMIN_EMAIL;
  const aal = tokenAal(token);
  const codeGiven = aal === "aal2";

  // A session that hasn't given a code: ask the auth server (not the copy
  // of the user saved in this browser, which can predate the setup) whether
  // an authenticator is on the account.
  useEffect(() => {
    if (!userId || !isAdmin || codeGiven) return;
    let cancelled = false;
    supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled) return;
      setFactorCheck(
        error || !data.user
          ? { userId, error: error?.message ?? "No answer from the sign-in service." }
          : { userId, factors: data.user.factors ?? [] }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, isAdmin, codeGiven, token, recheck]);

  async function sendMagicLink() {
    setAuthError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Come back to whichever admin page asked for the link.
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) setAuthError(error.message);
    else setLinkSent(true);
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    if (!password) {
      setAuthError("Enter your password, or use the magic-link button.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error)
      setAuthError(
        error.message === "Invalid login credentials"
          ? "Invalid login — if you haven't set a password yet, sign in with a magic link once and set one in the Account section."
          : error.message
      );
  }

  if (!authReady) {
    return (
      <main className="min-h-screen bg-black p-8 text-neutral-400">
        Loading…
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-black text-white">
        <section className="mx-auto max-w-md px-4 py-24">
          <h1 className="text-3xl font-semibold">Admin</h1>
          <p className="mt-3 text-sm text-neutral-400">
            Sign in with your password, or request a magic link.
          </p>
          {linkSent ? (
            <p className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-300">
              Check your inbox — a sign-in link is on its way. You can close
              this tab.
            </p>
          ) : (
            <form
              onSubmit={signInWithPassword}
              className="mt-6 flex flex-col gap-3"
            >
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className={inputClass}
              />
              <button type="submit" className={buttonClass}>
                Sign in
              </button>
              <button
                type="button"
                onClick={sendMagicLink}
                className="text-sm text-neutral-500 transition hover:text-white"
              >
                Email me a magic link instead
              </button>
              {authError ? (
                <p className="text-sm text-red-400">{authError}</p>
              ) : null}
            </form>
          )}
        </section>
      </main>
    );
  }

  if (session.user.email !== ADMIN_EMAIL) {
    return (
      <main className="min-h-screen bg-black text-white">
        <section className="mx-auto max-w-md px-4 py-24">
          <h1 className="text-3xl font-semibold">Not authorized</h1>
          <p className="mt-3 text-sm text-neutral-400">
            Signed in as {session.user.email}, which doesn&apos;t have access
            to this page.
          </p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className={`mt-6 ${buttonClass}`}
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  if (!codeGiven) {
    const checked = factorCheck?.userId === session.user.id ? factorCheck : null;
    if (!checked) {
      return (
        <main className="min-h-screen bg-black p-8 text-neutral-400">
          Loading…
        </main>
      );
    }
    if ("error" in checked) {
      return (
        <main className="min-h-screen bg-black text-white">
          <section className="mx-auto max-w-md px-4 py-24">
            <h1 className="text-3xl font-semibold">Couldn&apos;t finish signing in</h1>
            <p className="mt-3 text-sm text-neutral-400">
              The sign-in service didn&apos;t confirm this session
              ({checked.error}). Try again, or sign out and back in.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setFactorCheck(null);
                  setRecheck((n) => n + 1);
                }}
                className={buttonClass}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                className={buttonClass}
              >
                Sign out
              </button>
            </div>
          </section>
        </main>
      );
    }
    if (twoStepFor(aal, checked.factors) === "challenge") {
      return (
        <CodeStep
          supabase={supabase}
          factors={verifiedTotp(checked.factors)}
          onVerified={setSession}
        />
      );
    }
    // No authenticator on the account (a first sign-in, or the old one was
    // removed after a lost phone): nothing behind the gate would load, so
    // set one up here. Confirming its first code raises this session.
    return (
      <main className="min-h-screen bg-black text-white">
        <section className="mx-auto max-w-2xl px-4 py-16">
          <h1 className="text-3xl font-semibold">One more step</h1>
          <p className="mt-3 text-sm text-neutral-400">
            The admin only opens with two-step sign-in. Set it up once and
            you&apos;re in.
          </p>
          <TwoStepSection
            supabase={supabase}
            onTurnedOn={async () => {
              const { data } = await supabase.auth.getSession();
              if (data.session) setSession(data.session);
            }}
          />
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="mt-10 text-sm text-neutral-500 transition hover:text-white"
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <AdminSessionContext.Provider value={{ supabase, session }}>
      {children}
    </AdminSessionContext.Provider>
  );
}

// The second step: the 6-digit code from the authenticator app. Supabase
// swaps the session for one marked "aal2" when the code is right.
function CodeStep({
  supabase,
  factors,
  onVerified,
}: {
  supabase: SupabaseClient;
  factors: Factor[];
  onVerified: (session: Session) => void;
}) {
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(value: string) {
    if (busy || value.length !== 6 || !factorId) return;
    setBusy(true);
    setError("");
    const { error: failed } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: value,
    });
    if (failed) {
      setBusy(false);
      setCode("");
      setError(
        failed.code === "mfa_verification_failed"
          ? "That code didn't match. Wait for the app to show a new one and try again."
          : failed.message
      );
      return;
    }
    // The auth listener also hears about the new session; hand it over
    // directly so the admin opens without waiting on that.
    const { data } = await supabase.auth.getSession();
    if (data.session) onVerified(data.session);
    else setBusy(false);
  }

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-md px-4 py-24">
        <h1 className="text-3xl font-semibold">Enter your code</h1>
        <p className="mt-3 text-sm text-neutral-400">
          Open your authenticator app and type the 6-digit code for
          Curiouser Records admin.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
          className="mt-6 flex flex-col gap-3"
        >
          {factors.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm text-neutral-400">
              Which app
              <select
                value={factorId}
                onChange={(e) => setFactorId(e.target.value)}
                className={inputClass}
              >
                {factors.map((f) => (
                  <option key={f.id} value={f.id} className="text-black">
                    {f.friendly_name || "Authenticator app"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => {
              const next = cleanCode(e.target.value);
              setCode(next);
              // Six digits is the whole code: no need to press the button.
              if (next.length === 6) void submit(next);
            }}
            placeholder="123456"
            aria-label="6-digit code"
            // Not `disabled`: that would drop the cursor after a wrong code.
            readOnly={busy}
            className={`text-center text-lg tracking-[0.4em] ${inputClass}`}
          />
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className={primaryButtonClass}
          >
            {busy ? "Checking…" : "Continue"}
          </button>
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-neutral-500 transition hover:text-white"
          >
            Sign out
          </button>
        </form>
        <p className="mt-8 text-xs text-neutral-500">
          Lost the device? Use your spare app, or the setup key saved in your
          password manager. With neither, the authenticator has to be removed
          in the Supabase dashboard before you can sign in.
        </p>
      </section>
    </main>
  );
}
