import type { SupabaseClient } from "@supabase/supabase-js";

// A tiny in-memory stand-in for the Supabase query builder, for node tests
// of the *-db.ts writes. Only what those files call: select / insert /
// update / delete with eq, neq, in, is, gte, or (is.null / lt), order, limit,
// single, maybeSingle, and head counts. Rows are plain objects; `fail`
// makes the next matching write error, to test partial failures.

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export type FakeDb = {
  tables: Record<string, Row[]>;
  fail: { table: string; id: unknown; message: string }[];
};

export function fakeSupabase(tables: Record<string, Row[]>): {
  client: SupabaseClient;
  db: FakeDb;
} {
  const db: FakeDb = { tables, fail: [] };
  let nextId = 1000;

  function builder(table: string) {
    const rows = () => (db.tables[table] ??= []);
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | null = null;
    let head = false;
    let count = false;
    let limitN: number | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;

    const matching = () => {
      let out = rows().filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const { col, asc } = orderBy;
        out = [...out].sort((a, b) =>
          String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1)
        );
      }
      return limitN == null ? out : out.slice(0, limitN);
    };

    function run(): { data: unknown; error: { message: string } | null; count?: number } {
      if (op === "insert") {
        const row = { id: nextId++, created_at: new Date().toISOString(), ...payload };
        rows().push(row);
        return { data: [row], error: null };
      }
      const hit = matching();
      if (op === "select") {
        return head ? { data: null, error: null, count: hit.length } : { data: hit, error: null, ...(count ? { count: hit.length } : {}) };
      }
      const failing = db.fail.find((f) => f.table === table && hit.some((r) => r.id === f.id));
      if (failing) {
        db.fail = db.fail.filter((f) => f !== failing);
        return { data: null, error: { message: failing.message } };
      }
      if (op === "delete") {
        db.tables[table] = rows().filter((r) => !hit.includes(r));
        return { data: hit, error: null };
      }
      for (const r of hit) Object.assign(r, payload);
      return { data: hit, error: null };
    }

    const q = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) head = true;
        if (opts?.count) count = true;
        return q;
      },
      insert(row: Row) {
        op = "insert";
        payload = row;
        return q;
      },
      update(patch: Row) {
        op = "update";
        payload = patch;
        return q;
      },
      delete() {
        op = "delete";
        return q;
      },
      upsert(row: Row, opts: { onConflict: string }) {
        const key = opts.onConflict;
        const existing = rows().find((r) => r[key] === row[key]);
        if (existing) {
          op = "update";
          payload = row;
          filters.push((r) => r === existing);
        } else {
          op = "insert";
          payload = row;
        }
        return q;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return q;
      },
      neq(col: string, v: unknown) {
        filters.push((r) => r[col] !== v);
        return q;
      },
      is(col: string, v: null | boolean) {
        filters.push((r) => (v === null ? r[col] == null : r[col] === v));
        return q;
      },
      gte(col: string, v: unknown) {
        filters.push((r) => r[col] != null && String(r[col]) >= String(v));
        return q;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return q;
      },
      or(expr: string) {
        const parts = expr.split(",").map((p) => {
          const [col, opName, ...rest] = p.split(".");
          const value = rest.join(".").replace(/^"|"$/g, "");
          if (opName === "is" && value === "null") return (r: Row) => r[col] == null;
          if (opName === "lt") return (r: Row) => r[col] != null && String(r[col]) < value;
          throw new Error(`fake or(): unsupported ${p}`);
        });
        filters.push((r) => parts.some((f) => f(r)));
        return q;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderBy = { col, asc: opts?.ascending ?? true };
        return q;
      },
      limit(n: number) {
        limitN = n;
        return q;
      },
      async single() {
        const res = run();
        const list = (res.data as Row[] | null) ?? [];
        if (res.error) return { data: null, error: res.error };
        return list.length === 1
          ? { data: list[0], error: null }
          : { data: null, error: { message: `expected 1 row, got ${list.length}` } };
      },
      async maybeSingle() {
        const res = run();
        const list = (res.data as Row[] | null) ?? [];
        return res.error ? { data: null, error: res.error } : { data: list[0] ?? null, error: null };
      },
      then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  }

  const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient;
  return { client, db };
}
