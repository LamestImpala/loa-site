import type { AfterSaleItem } from "@/lib/admin/after-sale";
import type { TimelineStep } from "@/lib/admin/fulfillment";

// The two read-outs on an order card: its timeline (request → drop-off)
// and, once the boxes have left, the after-sale checklist. Both are
// plain renderers over the pure rules in lib/admin.

// PayPal reports a payment as a calendar day, stored as midnight UTC —
// shown in local time it would read as the evening before.
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(/T00:00:00(\.0+)?(Z|\+00:?00)$/.test(iso) ? { timeZone: "UTC" } : {}),
  });

const DOT: Record<TimelineStep["state"], string> = {
  done: "border-emerald-500/60 bg-emerald-500/20 text-emerald-300",
  current: "border-amber-400 text-amber-300",
  todo: "border-white/20 text-transparent",
};

export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol
      aria-label="Order timeline"
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs"
    >
      {steps.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.state === "current" ? "step" : undefined}
          className="flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${DOT[s.state]}`}
          >
            {s.state === "done" ? "✓" : s.state === "current" ? "•" : ""}
          </span>
          <span
            className={
              s.state === "done"
                ? "text-neutral-300"
                : s.state === "current"
                  ? "font-medium text-amber-200"
                  : "text-neutral-500"
            }
          >
            {s.label}
            <span className="sr-only">
              {s.state === "done" ? " (done)" : s.state === "current" ? " (next)" : " (not yet)"}
            </span>
          </span>
          {s.at || s.detail ? (
            <span className="text-neutral-500">{s.detail ?? shortDate(s.at as string)}</span>
          ) : null}
          {/* The line to the next step trails this one, so a wrapped row
              never starts with a dangling dash. */}
          {i < steps.length - 1 ? (
            <span aria-hidden="true" className="h-px w-3 bg-white/15" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const MARK: Record<AfterSaleItem["state"], { glyph: string; className: string; say: string }> = {
  done: { glyph: "✓", className: "text-emerald-400", say: "done" },
  scheduled: { glyph: "◷", className: "text-sky-300", say: "scheduled" },
  todo: { glyph: "○", className: "text-amber-300", say: "to do" },
  manual: { glyph: "○", className: "text-neutral-400", say: "yours to tick" },
};

// `actions` puts a control beside an item (the Discogs removal, the link
// to Reviews); `children` is the footer — Mark done, Reopen, undo.
export function AfterSale({
  items,
  actions,
  children,
}: {
  items: AfterSaleItem[];
  actions?: Partial<Record<AfterSaleItem["key"], React.ReactNode>>;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-xl border border-white/10 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        After the sale
      </p>
      {items.length > 0 ? (
        <ul className="mt-2 grid gap-1.5 text-sm">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span aria-hidden="true" className={`w-4 text-center ${MARK[i.state].className}`}>
                {MARK[i.state].glyph}
              </span>
              <span className={i.state === "done" ? "text-neutral-400" : "text-neutral-200"}>
                {i.label}
                <span className="sr-only"> ({MARK[i.state].say})</span>
              </span>
              <span className="text-xs text-neutral-500">{i.detail}</span>
              {actions?.[i.key] ?? null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-neutral-400">Nothing left to do on this one.</p>
      )}
      {children ? <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
