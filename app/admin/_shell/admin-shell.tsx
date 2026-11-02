"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useAdmin } from "./admin-provider";
import { AdminNav } from "./admin-nav";
import { ClipboardFallbackModal, ConfirmDialog, ToastStack, buttonClass } from "./ui";

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
    confirmRequest,
    clipboardFallback,
    setClipboardFallback,
  } = useAdmin();

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Shop logo: a way back to the storefront from any admin page.
              Opens in a new tab so the loaded tables and sale-desk selection
              here aren't thrown away. On a phone it shares the first row with
              the account controls and the nav scrolls on its own row below. */}
          <a
            href="/"
            target="_blank"
            rel="noopener"
            title="Open curiouserrecords.com in a new tab"
            aria-label="Open the Curiouser Records shop in a new tab"
            className="order-1 shrink-0 rounded-full transition hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Image
              src="/images/curiouserlogo.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 rounded-full"
            />
          </a>
          <AdminNav />
          <div className="order-2 flex flex-1 flex-wrap items-center justify-end gap-3 text-sm text-neutral-400 md:order-3 md:flex-none">
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
      <ConfirmDialog request={confirmRequest} />
      <ClipboardFallbackModal
        fallback={clipboardFallback}
        onClose={() => setClipboardFallback(null)}
      />
    </main>
  );
}
