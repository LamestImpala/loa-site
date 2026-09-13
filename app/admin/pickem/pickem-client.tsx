"use client";

import Link from "next/link";
import { useAdminSession } from "../admin-gate";
import { PickemPanel } from "../pickem-panel";
import { buttonClass } from "../ui";

// Pick'em has nothing to do with the record shop, so it gets its own page
// behind the same sign-in gate instead of a slot in the records admin.
export function PickemAdminClient() {
  const { supabase, session } = useAdminSession();
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold">Pick&apos;em Admin</h1>
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span>{session.user.email}</span>
            <Link href="/admin" className={buttonClass}>
              Records admin
            </Link>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className={buttonClass}
            >
              Sign out
            </button>
          </div>
        </div>
        <PickemPanel supabase={supabase} />
      </section>
    </main>
  );
}
