"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ADMIN_EMAIL, getBrowserSupabase } from "@/lib/supabase";
import { buttonClass, inputClass } from "./_shell/ui";

// Client-side sign-in gate shared by every /admin page. It only decides what
// to render — RLS and the per-route email checks are what actually protect
// the data — so pages under the gate can assume a signed-in admin session.

type AdminSession = { supabase: SupabaseClient; session: Session };

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

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

  return (
    <AdminSessionContext.Provider value={{ supabase, session }}>
      {children}
    </AdminSessionContext.Provider>
  );
}
