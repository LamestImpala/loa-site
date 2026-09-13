"use client";

// Which slice of the slate is on the board. The choice lives in the URL so
// it survives reloads and the magic-link round trip; writes go through
// history.replaceState, which Next syncs into useSearchParams without a
// server round trip.
import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { CONFERENCES, type Conference } from "@/lib/pickem-conferences";
import { parseView, viewQuery, type View } from "@/lib/pickem-board";

export function useBoardView(known: Conference[]) {
  const sp = useSearchParams();
  const viewParam = sp.get("view");
  const confParam = sp.get("conf");
  const parsed = useMemo(() => parseView(viewParam, confParam, known), [viewParam, confParam, known]);
  const setView = useCallback((view: View | "auto", conf: Conference | null) => {
    // Only the view keys change; ?league= (and the dev-only ?at=) stay put.
    const q = new URLSearchParams(window.location.search);
    q.delete("view");
    q.delete("conf");
    for (const [k, v] of new URLSearchParams(viewQuery(view, conf))) q.set(k, v);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);
  return { ...parsed, setView };
}

type Props = {
  view: View;
  conf: Conference | null;
  /** College has a conference view; the NFL slate is small enough not to need one. */
  showConference: boolean;
  soonCount: number;
  openCount: number;
  conferences: Conference[];
  onChange: (view: View, conf: Conference | null) => void;
};

const seg = (on: boolean) =>
  `h-9 rounded px-3 text-sm transition ${on ? "bg-white text-neutral-950" : "text-neutral-300 hover:text-white"}`;

export default function ViewPicker({ view, conf, showConference, soonCount, openCount, conferences, onChange }: Props) {
  return (
    // Pinned under the site nav: 80px (md: 84px) of logo and padding plus its
    // 1px border. Keep in step with app/(loa)/site-nav.tsx.
    <div className="sticky top-[81px] z-40 -mx-4 border-b border-white/10 bg-neutral-950/90 px-4 py-2 backdrop-blur md:-mx-8 md:top-[85px] md:px-8">
      <div role="group" aria-label="Board view" className="inline-flex gap-0.5 rounded-md border border-white/15 p-0.5">
        <button type="button" aria-pressed={view === "soon"} onClick={() => onChange("soon", conf)} className={seg(view === "soon")}>
          Starting soon{soonCount ? <span className="ml-1.5 tabular-nums opacity-70">{soonCount}</span> : null}
        </button>
        {showConference ? (
          <button type="button" aria-pressed={view === "conf"} onClick={() => onChange("conf", conf ?? conferences[0] ?? null)} className={seg(view === "conf")}>
            Conference
          </button>
        ) : null}
        <button type="button" aria-pressed={view === "all"} onClick={() => onChange("all", conf)} className={seg(view === "all")}>
          All<span className="ml-1.5 tabular-nums opacity-70">{openCount}</span>
        </button>
      </div>
      {showConference && view === "conf" ? (
        <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:-mx-8 md:px-8 [&::-webkit-scrollbar]:hidden">
          {(conferences.length ? conferences : CONFERENCES).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={conf === c}
              onClick={() => onChange("conf", c)}
              className={`h-8 shrink-0 rounded border px-2.5 text-[13px] transition ${
                conf === c ? "border-white bg-white text-neutral-950" : "border-white/15 text-neutral-300 hover:border-white/40 hover:text-white"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
