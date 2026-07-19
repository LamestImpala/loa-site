/*
 * Daily Discogs price run.
 *
 * For every listed, unsold record with a Discogs release ID, fetches the
 * Discogs price suggestion for its media grade and computes a target price
 * of round(suggestion * PRICE_FACTOR). Moves within ±THRESHOLD apply
 * automatically; bigger moves are queued in pending_price_changes for
 * approval on /admin. Each run is logged to price_runs, and an email report
 * is sent via Resend when anything was flagged (if RESEND_API_KEY is set).
 *
 * Required env: DISCOGS_TOKEN, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: RESEND_API_KEY
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://spmbjuurarlpyqcqxyyz.supabase.co";
const REPORT_EMAIL = "brandoncgillihan@gmail.com";
const PRICE_FACTOR = 0.85; // ask 85% of the Discogs suggested price
const THRESHOLD = 0.05; // auto-apply moves within ±5%

const GRADE_KEY = {
  M: "Mint (M)",
  NM: "Near Mint (NM or M-)",
  "VG+": "Very Good Plus (VG+)",
  VG: "Very Good (VG)",
  "G+": "Good Plus (G+)",
  G: "Good (G)",
  F: "Fair (F)",
  P: "Poor (P)",
};

const discogsToken = process.env.DISCOGS_TOKEN;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!discogsToken || !serviceKey) {
  console.error("DISCOGS_TOKEN and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, serviceKey, {
  auth: { persistSession: false },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSuggestion(releaseId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`,
      {
        headers: {
          Authorization: `Discogs token=${discogsToken}`,
          "User-Agent": "LateOnsetAudiophileRecords/1.0",
        },
      }
    );
    if (res.status === 429) {
      // rate limited — back off and retry
      await sleep(65_000);
      continue;
    }
    if (res.status === 404) return null; // no suggestions for this release
    if (!res.ok) throw new Error(`Discogs ${res.status} for ${releaseId}`);
    return res.json();
  }
  throw new Error(`Rate limited three times for ${releaseId}`);
}

// Fill in cover art for records that don't have it yet (new listings).
async function backfillCoverImages() {
  const { data: missing, error } = await supabase
    .from("records")
    .select("id, discogs_release_id")
    .eq("cover_image", "")
    .not("discogs_release_id", "is", null);
  if (error) throw error;
  for (const r of missing) {
    try {
      const res = await fetch(
        `https://api.discogs.com/releases/${r.discogs_release_id}`,
        {
          headers: {
            Authorization: `Discogs token=${discogsToken}`,
            "User-Agent": "LateOnsetAudiophileRecords/1.0",
          },
        }
      );
      if (!res.ok) continue;
      const rel = await res.json();
      const primary =
        rel?.images?.find((im) => im.type === "primary") ?? rel?.images?.[0];
      const uri = primary?.uri || rel?.thumb || "";
      if (uri) {
        await supabase
          .from("records")
          .update({ cover_image: uri })
          .eq("id", r.id);
      }
    } catch (e) {
      console.error(`cover image for record ${r.id}:`, e.message);
    }
    await sleep(1100);
  }
}

async function main() {
  await backfillCoverImages();

  const { data: records, error } = await supabase
    .from("records")
    .select("id, artist, title, media, price, discogs_release_id")
    .eq("listed", true)
    .eq("sold", false)
    .not("discogs_release_id", "is", null);
  if (error) throw error;

  const { data: pendingRows, error: pendingErr } = await supabase
    .from("pending_price_changes")
    .select("record_id")
    .eq("status", "pending");
  if (pendingErr) throw pendingErr;
  const hasPending = new Set(pendingRows.map((p) => p.record_id));

  const summary = [];
  let checked = 0;
  let autoApplied = 0;
  let flagged = 0;
  let errors = 0;

  const { data: run, error: runErr } = await supabase
    .from("price_runs")
    .insert({})
    .select()
    .single();
  if (runErr) throw runErr;

  for (const r of records) {
    try {
      const suggestions = await fetchSuggestion(r.discogs_release_id);
      checked++;
      const gradeKey = GRADE_KEY[r.media];
      const suggestion = suggestions?.[gradeKey]?.value;
      if (!suggestion) continue;

      const target = Math.round(suggestion * PRICE_FACTOR);
      if (target < 1 || target === r.price || r.price === 0) continue;

      const pct = (target - r.price) / r.price;
      const entry = {
        record_id: r.id,
        artist: r.artist,
        title: r.title,
        old_price: r.price,
        new_price: target,
        pct: Number(pct.toFixed(4)),
      };

      if (Math.abs(pct) <= THRESHOLD) {
        const { error: updErr } = await supabase
          .from("records")
          .update({ price: target, updated_at: new Date().toISOString() })
          .eq("id", r.id);
        if (updErr) throw updErr;
        autoApplied++;
        summary.push({ ...entry, action: "applied" });
      } else if (!hasPending.has(r.id)) {
        const { error: insErr } = await supabase
          .from("pending_price_changes")
          .insert({
            record_id: r.id,
            run_id: run.id,
            old_price: r.price,
            suggested_price: target,
            pct_change: Number(pct.toFixed(4)),
          });
        if (insErr) throw insErr;
        flagged++;
        summary.push({ ...entry, action: "flagged" });
      }
    } catch (e) {
      errors++;
      console.error(`${r.artist} — ${r.title}:`, e.message);
    }
    await sleep(1100); // Discogs allows 60 requests/minute
  }

  await supabase
    .from("price_runs")
    .update({ checked, auto_applied: autoApplied, flagged, errors, summary })
    .eq("id", run.id);

  console.log(
    `Done: ${checked} checked, ${autoApplied} auto-applied, ${flagged} flagged, ${errors} errors`
  );

  if (flagged > 0 && process.env.RESEND_API_KEY) {
    const flaggedRows = summary
      .filter((s) => s.action === "flagged")
      .map(
        (s) =>
          `<tr><td>${s.artist} — ${s.title}</td><td>$${s.old_price}</td><td>$${s.new_price}</td><td>${(s.pct * 100).toFixed(1)}%</td></tr>`
      )
      .join("");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Records Price Run <onboarding@resend.dev>",
        to: [REPORT_EMAIL],
        subject: `Price run: ${flagged} record${flagged === 1 ? "" : "s"} moved more than ±5%`,
        html: `<p>${checked} records checked, ${autoApplied} small changes auto-applied.</p>
<p>These moved more than ±5% and are waiting for your approval at
<a href="https://lateonsetaudiophile.com/admin">lateonsetaudiophile.com/admin</a>:</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Record</th><th>Current</th><th>Suggested</th><th>Change</th></tr>
${flaggedRows}
</table>`,
      }),
    });
    if (!res.ok) {
      console.error("Email failed:", res.status, await res.text());
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
