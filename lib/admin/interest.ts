import type { RecordEventRow, ShopVisitRow } from "../supabase.ts";

// One local-calendar-day slice of shopper activity; "visited"/"looked"/"asked"
// count distinct anonymous sessions, "clicks" counts raw events. A session
// that clicked also visited, so visited >= looked even for clicks logged
// before visits were tracked. Days are bucketed in the browser's timezone so
// late-evening visits don't roll into tomorrow.
export type DayBucket = {
  key: string; // local yyyy-mm-dd, sorts chronologically
  label: string; // e.g. "Aug 27"
  visited: number;
  clicks: number;
  looked: number;
  asked: number;
  topReferrer: string | null; // site that sent the most sessions that day
};

export function localDayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function dayLabel(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// "l.facebook.com" and "m.facebook.com" are the same place to the owner.
export function referrerName(host: string) {
  return host.replace(/^(www|m|l|lm|out)\./, "");
}

type DayAcc = {
  clicks: number;
  visit: Set<string>;
  look: Set<string>;
  ask: Set<string>;
  refs: Map<string, Set<string>>;
};

export function bucketEventsByDay(
  events: RecordEventRow[],
  visits: ShopVisitRow[] = []
): DayBucket[] {
  const days = new Map<string, DayAcc>();
  const dayFor = (at: string) => {
    const key = localDayKey(new Date(at));
    let day = days.get(key);
    if (!day) {
      day = { clicks: 0, visit: new Set(), look: new Set(), ask: new Set(), refs: new Map() };
      days.set(key, day);
    }
    return day;
  };
  for (const e of events) {
    const day = dayFor(e.created_at);
    day.visit.add(e.session_id);
    if (e.event_type === "buy_request") {
      day.ask.add(e.session_id);
    } else {
      day.clicks += 1;
      day.look.add(e.session_id);
    }
  }
  for (const v of visits) {
    const day = dayFor(v.created_at);
    day.visit.add(v.session_id);
    if (v.referrer_host) {
      const name = referrerName(v.referrer_host);
      const sessions = day.refs.get(name) ?? new Set<string>();
      sessions.add(v.session_id);
      day.refs.set(name, sessions);
    }
  }
  return [...days.entries()]
    .map(([key, d]) => ({
      key,
      label: dayLabel(key),
      visited: d.visit.size,
      clicks: d.clicks,
      looked: d.look.size,
      asked: d.ask.size,
      topReferrer:
        [...d.refs.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0] ??
        null,
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1)); // newest first
}

// A contiguous run of the last `days` local days ending today, zero-filled
// so quiet days show as gaps in the "Interest by day" strip. Oldest first.
export function recentDays(
  events: RecordEventRow[],
  visits: ShopVisitRow[] = [],
  days = 14,
  now: Date = new Date()
): DayBucket[] {
  const byKey = new Map(bucketEventsByDay(events, visits).map((d) => [d.key, d]));
  const out: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localDayKey(d);
    out.push(
      byKey.get(key) ?? {
        key,
        label: dayLabel(key),
        visited: 0,
        clicks: 0,
        looked: 0,
        asked: 0,
        topReferrer: null,
      }
    );
  }
  return out;
}
