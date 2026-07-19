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
const UNDERCUT_BY = 1; // competitive price = $1 below the cheapest listing
const MAX_AUTO_CUT = 0.1; // auto-apply competitive cuts up to 10%
const FLOOR_FACTOR = 0.7; // never auto-price below 70% of the grade suggestion

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
    .eq("manual_price", false) // admin-locked prices are left alone
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
  let aboveLowest = 0;
  let undercuts = 0;
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

      let price = r.price; // tracks changes made within this iteration

      const target = Math.round(suggestion * PRICE_FACTOR);
      if (target >= 1 && target !== price) {
        const entry = {
          record_id: r.id,
          artist: r.artist,
          title: r.title,
          old_price: price,
          new_price: target,
        };

        if (price === 0) {
          // new record with no price yet — set it directly
          const { error: updErr } = await supabase
            .from("records")
            .update({ price: target, updated_at: new Date().toISOString() })
            .eq("id", r.id);
          if (updErr) throw updErr;
          autoApplied++;
          price = target;
          summary.push({ ...entry, pct: 0, action: "applied" });
        } else {
          const pct = (target - price) / price;
          if (Math.abs(pct) <= THRESHOLD) {
            const { error: updErr } = await supabase
              .from("records")
              .update({ price: target, updated_at: new Date().toISOString() })
              .eq("id", r.id);
            if (updErr) throw updErr;
            autoApplied++;
            price = target;
            summary.push({ ...entry, pct: Number(pct.toFixed(4)), action: "applied" });
          } else if (!hasPending.has(r.id)) {
            const { error: insErr } = await supabase
              .from("pending_price_changes")
              .insert({
                record_id: r.id,
                run_id: run.id,
                old_price: price,
                suggested_price: target,
                pct_change: Number(pct.toFixed(4)),
              });
            if (insErr) throw insErr;
            hasPending.add(r.id);
            flagged++;
            summary.push({ ...entry, pct: Number(pct.toFixed(4)), action: "flagged" });
          }
        }
      }

      // Competitive check: is our price above the cheapest Discogs listing?
      // Buyers see that number, so undercut it by $1 — automatically when
      // the cut is small (≤MAX_AUTO_CUT) and stays above the floor
      // (FLOOR_FACTOR × grade suggestion); otherwise queue it for approval.
      await sleep(1100);
      if (price > 0) {
        const statsRes = await fetch(
          `https://api.discogs.com/marketplace/stats/${r.discogs_release_id}?curr_abbr=USD`,
          {
            headers: {
              Authorization: `Discogs token=${discogsToken}`,
              "User-Agent": "LateOnsetAudiophileRecords/1.0",
            },
          }
        );
        if (statsRes.ok) {
          const stats = await statsRes.json();
          const lowest = stats?.lowest_price?.value;
          const forSale = stats?.num_for_sale ?? null;
          const competitive = lowest
            ? Math.max(Math.round(lowest) - UNDERCUT_BY, 1)
            : null;
          if (lowest && price > lowest && competitive < price) {
            aboveLowest++;
            const floor = Math.round(suggestion * FLOOR_FACTOR);
            const cutPct = Number(((competitive - price) / price).toFixed(4));
            const entry = {
              record_id: r.id,
              artist: r.artist,
              title: r.title,
              old_price: price,
              new_price: competitive,
              pct: cutPct,
              lowest: Math.round(lowest),
              for_sale: forSale,
            };
            if (Math.abs(cutPct) <= MAX_AUTO_CUT && competitive >= floor) {
              const { error: updErr } = await supabase
                .from("records")
                .update({
                  price: competitive,
                  prev_price: price,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", r.id);
              if (updErr) throw updErr;
              undercuts++;
              summary.push({ ...entry, action: "undercut" });
            } else if (!hasPending.has(r.id)) {
              const { error: insErr } = await supabase
                .from("pending_price_changes")
                .insert({
                  record_id: r.id,
                  run_id: run.id,
                  old_price: price,
                  suggested_price: competitive,
                  pct_change: cutPct,
                });
              if (insErr) throw insErr;
              hasPending.add(r.id);
              summary.push({ ...entry, action: "above-lowest" });
            }
          }
        }
      }
    } catch (e) {
      errors++;
      console.error(`${r.artist} — ${r.title}:`, e.message);
    }
    await sleep(1100); // Discogs allows 60 requests/minute
  }

  await supabase
    .from("price_runs")
    .update({
      checked,
      auto_applied: autoApplied,
      flagged,
      above_lowest: aboveLowest,
      undercuts,
      errors,
      summary,
    })
    .eq("id", run.id);

  console.log(
    `Done: ${checked} checked, ${autoApplied} auto-applied, ${undercuts} undercuts, ${flagged} flagged, ${aboveLowest} above lowest listing, ${errors} errors`
  );

  const pendingCuts = summary.filter((s) => s.action === "above-lowest");
  if (
    (flagged > 0 || undercuts > 0 || pendingCuts.length > 0) &&
    process.env.RESEND_API_KEY
  ) {
    const suggestionRows = (action) =>
      summary
        .filter((s) => s.action === action)
        .map(
          (s) =>
            `<tr><td>${s.artist} — ${s.title}</td><td>$${s.old_price}</td><td>$${s.new_price}</td><td>${(s.pct * 100).toFixed(1)}%</td></tr>`
        )
        .join("");
    const cutRow = (s) =>
      `<tr><td>${s.artist} — ${s.title}</td><td>$${s.old_price}</td><td>$${s.lowest}</td><td>$${s.new_price}</td><td>${(s.pct * 100).toFixed(1)}%</td><td>${s.for_sale ?? "?"}</td></tr>`;
    const cutHeader = `<tr><th>Record</th><th>Your price</th><th>Lowest listing</th><th>Suggested</th><th>Cut</th><th>Copies for sale</th></tr>`;

    const flaggedSection =
      flagged > 0
        ? `<p>These moved more than ±5% on the Discogs suggestion and are waiting for your approval at
<a href="https://www.lateonsetaudiophile.com/admin">lateonsetaudiophile.com/admin</a>:</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Record</th><th>Current</th><th>Suggested</th><th>Change</th></tr>
${suggestionRows("flagged")}
</table>`
        : "";

    // Sort pending cuts biggest-gap-first, then split into ones worth
    // acting on vs. likely condition noise (big gap or scarce copies).
    const sortedCuts = [...pendingCuts].sort((a, b) => a.pct - b.pct);
    const actionable = sortedCuts.filter(
      (s) => Math.abs(s.pct) <= 0.3 && (s.for_sale ?? 0) >= 3
    );
    const noise = sortedCuts.filter((s) => !actionable.includes(s));
    const cutsSection =
      sortedCuts.length > 0
        ? `<p>These are priced <strong>above the cheapest current Discogs listing</strong>.
One-click Approve at <a href="https://www.lateonsetaudiophile.com/admin">lateonsetaudiophile.com/admin</a>
sets the suggested price ($1 under the lowest listing).</p>
${
  actionable.length > 0
    ? `<p><strong>Worth acting on</strong> (modest gap, several copies competing):</p>
<table border="1" cellpadding="6" cellspacing="0">${cutHeader}${actionable.map(cutRow).join("")}</table>`
    : ""
}
${
  noise.length > 0
    ? `<p><strong>Probably condition noise or scarce</strong> (big gap — often a low-grade copy anchoring the price — or few copies for sale; check the listing before cutting):</p>
<table border="1" cellpadding="6" cellspacing="0">${cutHeader}${noise.map(cutRow).join("")}</table>`
    : ""
}`
        : "";

    const undercutSection =
      undercuts > 0
        ? `<p>Auto-undercut to $1 below the cheapest listing (cut ≤10% and above the
${FLOOR_FACTOR * 100}% floor of the grade suggestion):</p>
<table border="1" cellpadding="6" cellspacing="0">${cutHeader}${summary
            .filter((s) => s.action === "undercut")
            .map(cutRow)
            .join("")}</table>`
        : "";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Records Price Run <onboarding@resend.dev>",
        to: [REPORT_EMAIL],
        subject: `Price run: ${undercuts} auto-undercut, ${flagged + pendingCuts.length} awaiting approval`,
        html: `<p>${checked} records checked, ${autoApplied} suggestion changes auto-applied, ${undercuts} competitive undercuts applied.</p>
${flaggedSection}
${cutsSection}
${undercutSection}`,
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
