import type { RecordEventRow } from "../supabase.ts";

// One local-calendar-day slice of shopper activity; "looked"/"asked" count
// distinct anonymous sessions, "clicks" counts raw events. Days are bucketed
// in the browser's timezone so late-evening visits don't roll into tomorrow.
export type DayBucket = {
  key: string; // local yyyy-mm-dd, sorts chronologically
  label: string; // e.g. "Aug 27"
  clicks: number;
  looked: number;
  asked: number;
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

export function bucketEventsByDay(events: RecordEventRow[]): DayBucket[] {
  const days = new Map<
    string,
    { clicks: number; look: Set<string>; ask: Set<string> }
  >();
  for (const e of events) {
    const key = localDayKey(new Date(e.created_at));
    let day = days.get(key);
    if (!day) {
      day = { clicks: 0, look: new Set(), ask: new Set() };
      days.set(key, day);
    }
    if (e.event_type === "buy_request") {
      day.ask.add(e.session_id);
    } else {
      day.clicks += 1;
      day.look.add(e.session_id);
    }
  }
  return [...days.entries()]
    .map(([key, d]) => ({
      key,
      label: dayLabel(key),
      clicks: d.clicks,
      looked: d.look.size,
      asked: d.ask.size,
    }))
    .sort((a, b) => (a.key < b.key ? 1 : -1)); // newest first
}

// A contiguous run of the last `days` local days ending today, zero-filled
// so quiet days show as gaps in the "Interest by day" strip. Oldest first.
export function recentDays(
  events: RecordEventRow[],
  days = 14,
  now: Date = new Date()
): DayBucket[] {
  const byKey = new Map(bucketEventsByDay(events).map((d) => [d.key, d]));
  const out: DayBucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = localDayKey(d);
    out.push(
      byKey.get(key) ?? { key, label: dayLabel(key), clicks: 0, looked: 0, asked: 0 }
    );
  }
  return out;
}
