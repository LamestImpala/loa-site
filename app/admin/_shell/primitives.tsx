import type { ReactNode } from "react";
import Link from "next/link";

// The four building blocks every admin page shares, so a title, a row of
// tabs, a status pill and "nothing here" look the same everywhere. Pages
// move onto these as each one is rebuilt.

// The top of a page: its name, one line on what it's for, and (optionally)
// the page's main actions on the right.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mt-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-neutral-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const PILL_TONES = {
  neutral: "border-white/15 text-neutral-400",
  amber: "border-amber-400/40 text-amber-300",
  green: "border-emerald-500/40 text-emerald-300",
  red: "border-red-500/40 text-red-300",
  sky: "border-sky-400/40 text-sky-300",
  // A count of jobs waiting: solid, so it reads at a glance in the nav.
  count: "border-transparent bg-amber-400 font-semibold text-black",
} as const;

export type PillTone = keyof typeof PILL_TONES;

// A small rounded label: a status ("pending"), or with tone="count" the
// number of jobs waiting. `label` is what a screen reader hears instead.
export function Pill({
  tone = "neutral",
  label,
  children,
}: {
  tone?: PillTone;
  label?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={label}
      className={`inline-flex shrink-0 items-center rounded-full border text-xs ${
        tone === "count" ? "px-1.5 leading-5" : "px-2 py-0.5"
      } ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export type TabItem = {
  href: string;
  label: string;
  active: boolean;
  count?: number; // jobs waiting behind the tab; shown when above zero
  countLabel?: string; // "to pack" — read out after the number
};

// A row of links between sibling pages (or views of one page), with the
// current one underlined. Scrolls sideways on a phone rather than wrapping.
export function Tabs({ label, tabs }: { label: string; tabs: TabItem[] }) {
  return (
    <nav
      aria-label={label}
      className="mt-5 flex gap-1 overflow-x-auto border-b border-white/10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition hover:text-white ${
            t.active
              ? "border-white text-white"
              : "border-transparent text-neutral-400 hover:border-white/30"
          }`}
        >
          {t.label}
          {t.count ? (
            <Pill tone="count" label={`${t.count} ${t.countLabel ?? "waiting"}`}>
              {t.count}
            </Pill>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}

// What a list shows when there's nothing in it — said plainly, with an
// optional link to where the next thing comes from.
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-neutral-400">
      {children}
    </p>
  );
}
