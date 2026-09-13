"use client";

import type { ReactNode } from "react";
import { useAdmin } from "./admin-provider";
import { AdminNav } from "./admin-nav";
import { ClipboardFallbackModal, ToastStack, buttonClass } from "./ui";

// Page chrome shared by every /admin page: nav, account controls, the
// load-error banner, and the toast / clipboard-fallback overlays.
export function AdminShell({ children }: { children: ReactNode }) {
  const {
    supabase,
    session,
    loading,
    loadData,
    loadError,
    setLoadError,
    toasts,
    dismissToast,
    clipboardFallback,
    setClipboardFallback,
  } = useAdmin();

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <AdminNav />
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span>{session.user.email}</span>
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              title="Reload everything from the database — useful after working in another tab"
              className={buttonClass}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className={buttonClass}
            >
              Sign out
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => setLoadError("")}
              aria-label="Dismiss error"
              className="text-red-300 transition hover:text-white"
            >
              ×
            </button>
          </div>
        ) : null}

        {children}
      </section>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ClipboardFallbackModal
        fallback={clipboardFallback}
        onClose={() => setClipboardFallback(null)}
      />
    </main>
  );
}
