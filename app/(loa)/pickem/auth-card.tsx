"use client";

// Sign-in strip. Four states: checking, email form, name form, signed in.
import type { PickemSession } from "./use-pickem-session";

type Props = { auth: PickemSession; myPickCount: number; openCount: number };

const input =
  "h-10 w-full rounded-md border border-white/15 bg-neutral-900 px-3 text-base text-white outline-none placeholder:text-neutral-500 focus:border-orange-400/60 sm:text-sm";
const primary = "h-10 shrink-0 rounded-md bg-orange-500 px-4 text-sm font-medium text-white transition hover:bg-orange-400";

export default function AuthCard({ auth, myPickCount, openCount }: Props) {
  const a = auth;
  return (
    <div className="border-y border-white/10 py-3 text-sm">
      {!a.authReady ? (
        <p className="text-neutral-400">Checking sign-in…</p>
      ) : !a.session ? (
        a.linkSent ? (
          <p className="text-neutral-200">
            Check <span className="font-medium text-white">{a.email}</span> for a sign-in link. It brings you straight back here.
          </p>
        ) : (
          <form onSubmit={a.sendMagicLink} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="pickem-email" className="shrink-0 text-neutral-300">
              Sign in to make picks
            </label>
            <input
              id="pickem-email"
              type="email"
              required
              autoComplete="email"
              value={a.email}
              onChange={(e) => a.setEmail(e.target.value)}
              placeholder="you@example.com"
              className={`${input} sm:max-w-xs`}
            />
            <button type="submit" className={primary}>
              Email me a link
            </button>
            {a.authError ? <p className="text-red-300">{a.authError}</p> : null}
          </form>
        )
      ) : a.displayName === "" ? (
        <form onSubmit={a.saveProfile} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="pickem-name" className="shrink-0 text-neutral-300">
            Name for the leaderboard
          </label>
          <input
            id="pickem-name"
            type="text"
            required
            minLength={2}
            maxLength={24}
            value={a.nameDraft}
            onChange={(e) => a.setNameDraft(e.target.value)}
            placeholder="2 to 24 characters"
            className={`${input} sm:max-w-xs`}
          />
          <button type="submit" className={primary}>
            Save
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-neutral-300">
            Picking as <span className="font-medium text-white">{a.displayName ?? "…"}</span>
            <span className="text-neutral-500">
              {" "}· {myPickCount} pick{myPickCount === 1 ? "" : "s"} in · {openCount} game{openCount === 1 ? "" : "s"} open
            </span>
          </p>
          <button type="button" onClick={a.signOut} className="text-neutral-400 underline-offset-2 hover:text-white hover:underline">
            Sign out
          </button>
        </div>
      )}
      {a.error ? <p className="mt-2 text-red-300">{a.error}</p> : null}
    </div>
  );
}
