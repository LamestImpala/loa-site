import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planImport, type CollectionCopy } from "@/lib/admin/discogs-import";
import { recordRowFromRelease } from "@/lib/admin/discogs-row";
import { getDiscogsCollection } from "@/lib/discogs";
import { authorizeJob } from "@/lib/job-auth";
import { serviceSupabase } from "@/lib/supabase-service";

// Discogs collection → Stock. Runs hourly on the Vercel cron in vercel.json
// (and from the Catalog's "Check Discogs" button): every copy in the Discogs
// collection that has no record in Stock becomes a draft — off the shop,
// ungraded, $0. An ungraded draft is never priced or published by the daily
// price run, so it waits in Stock until it is graded there.
//
// Copies already dealt with are remembered in discogs_imports (see
// lib/admin/discogs-import.ts for how copies are paired with records).
// `?dry=1` reports what a run would do and writes nothing.
export const maxDuration = 60;

// One Discogs call per import, 60 a minute allowed; a bigger backlog is
// finished by the following runs.
const MAX_PER_RUN = 25;
const PACE_MS = 1100;
const BUDGET_MS = 45_000;

const TABLE_MISSING = new Set(["PGRST205", "42P01"]);

// Every row of a query, past PostgREST's 1000-row page.
async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>
): Promise<{ rows: T[]; error: { code?: string; message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows, error: null };
  }
}

type Pending = { instance_id: number; release_id: number; artist: string; title: string };

async function run(req: NextRequest) {
  if (!(await authorizeJob(req))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const started = Date.now();
  try {
    const supabase: SupabaseClient = serviceSupabase();

    const seenRes = await allRows<{ instance_id: number }>((from, to) =>
      supabase.from("discogs_imports").select("instance_id").order("instance_id").range(from, to)
    );
    const tableMissing = !!seenRes.error && TABLE_MISSING.has(seenRes.error.code ?? "");
    if (seenRes.error && !(dry && tableMissing)) {
      return Response.json(
        {
          error: tableMissing
            ? "The discogs_imports table doesn't exist yet — apply migration 20261122_discogs_imports.sql. Nothing was imported."
            : seenRes.error.message,
        },
        { status: 500 }
      );
    }

    const stockRes = await allRows<{ discogs_release_id: number }>((from, to) =>
      supabase
        .from("records")
        .select("discogs_release_id")
        .not("discogs_release_id", "is", null)
        .not("discogs_removed", "is", true)
        .order("id")
        .range(from, to)
    );
    if (stockRes.error) {
      return Response.json({ error: stockRes.error.message }, { status: 500 });
    }

    const collection = await getDiscogsCollection({ fresh: true });
    const names = new Map<number, { artist: string; title: string }>();
    const copies: CollectionCopy[] = [];
    for (const item of collection) {
      if (!item.instance_id) continue;
      const release_id = item.basic_information?.id ?? item.id;
      copies.push({ instance_id: item.instance_id, release_id, date_added: item.date_added });
      names.set(item.instance_id, {
        artist: (item.basic_information?.artists ?? []).map((a) => a.name).join(", "),
        title: item.basic_information?.title ?? "",
      });
    }

    const plan = planImport(
      copies,
      seenRes.rows.map((r) => Number(r.instance_id)),
      stockRes.rows.map((r) => Number(r.discogs_release_id))
    );
    const pending: Pending[] = plan.toImport.map((c) => ({
      instance_id: c.instance_id,
      release_id: c.release_id,
      ...(names.get(c.instance_id) ?? { artist: "", title: "" }),
    }));

    if (dry) {
      return Response.json({
        dry: true,
        collection: copies.length,
        matched: plan.matched.length,
        remaining: pending.length,
        pending,
      });
    }

    // Copies that already have a record: remember them so they're settled.
    for (let i = 0; i < plan.matched.length; i += 500) {
      const { error } = await supabase.from("discogs_imports").upsert(
        plan.matched.slice(i, i + 500).map((c) => ({
          instance_id: c.instance_id,
          release_id: c.release_id,
          record_id: null,
        })),
        { onConflict: "instance_id", ignoreDuplicates: true }
      );
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    const token = process.env.DISCOGS_TOKEN;
    const imported: { id: number; artist: string; title: string }[] = [];
    const failed: { release_id: number; error: string }[] = [];
    let stopped = "";
    for (const copy of pending.slice(0, MAX_PER_RUN)) {
      if (Date.now() - started > BUDGET_MS) {
        stopped = "out of time";
        break;
      }
      if (imported.length + failed.length > 0) await new Promise((r) => setTimeout(r, PACE_MS));
      const res = await fetch(`https://api.discogs.com/releases/${copy.release_id}`, {
        headers: {
          "User-Agent": "LateOnsetAudiophile/1.0",
          ...(token ? { Authorization: `Discogs token=${token}` } : {}),
        },
        cache: "no-store",
      });
      if (res.status === 429) {
        stopped = "Discogs rate limit";
        break;
      }
      if (!res.ok) {
        failed.push({ release_id: copy.release_id, error: `Discogs returned ${res.status}` });
        continue;
      }
      const row = recordRowFromRelease(await res.json());
      // listed defaults to true in the table — a draft must say false.
      const { data, error } = await supabase
        .from("records")
        .insert({
          kind: "record",
          artist: row.artist.trim() || copy.artist,
          title: row.title.trim() || copy.title,
          pressing: row.pressing.trim(),
          media: "",
          sleeve: "",
          price: 0,
          cover_image: row.cover_image,
          discogs_release_id: copy.release_id,
          genres: row.genres,
          collection: row.collection.trim() || null,
          ...row.details,
          listed: false,
          draft: true,
        })
        .select("id, artist, title")
        .single();
      if (error || !data) {
        failed.push({ release_id: copy.release_id, error: error?.message ?? "insert failed" });
        continue;
      }
      imported.push(data);
      // If this write is lost, the next run pairs the copy with the new
      // record instead of importing it twice.
      const { error: seenError } = await supabase
        .from("discogs_imports")
        .upsert(
          { instance_id: copy.instance_id, release_id: copy.release_id, record_id: data.id },
          { onConflict: "instance_id" }
        );
      if (seenError) console.error("discogs-import: couldn't remember a copy:", seenError.message);
    }

    const remaining = pending.length - imported.length;
    if (imported.length > 0 || failed.length > 0 || stopped) {
      console.log(
        `discogs-import: added ${imported.length} draft${imported.length === 1 ? "" : "s"}` +
          `${imported.length ? ` (${imported.map((r) => `${r.artist} – ${r.title}`).join("; ")})` : ""}` +
          `, matched ${plan.matched.length}, remaining ${remaining}` +
          `${failed.length ? `, failed ${failed.map((f) => `${f.release_id}: ${f.error}`).join("; ")}` : ""}` +
          `${stopped ? `, stopped: ${stopped}` : ""}`
      );
    }
    return Response.json({
      imported,
      matched: plan.matched.length,
      remaining,
      failed,
      ...(stopped ? { stopped } : {}),
    });
  } catch (e) {
    console.error("discogs-import failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: e instanceof Error ? e.message : "import failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
