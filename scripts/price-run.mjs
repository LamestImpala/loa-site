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

// --- eBay Browse API (optional second market signal) ---
// Set EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (production keyset from
// developer.ebay.com) to enable; the run works fine without them.
const ebayId = process.env.EBAY_CLIENT_ID;
const ebaySecret = process.env.EBAY_CLIENT_SECRET;
let ebayToken = null;

async function getEbayToken() {
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " + Buffer.from(`${ebayId}:${ebaySecret}`).toString("base64"),
    },
    body:
      "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  if (!res.ok) throw new Error(`eBay token request failed: ${res.status}`);
  return (await res.json()).access_token;
}

const searchTokens = (s) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

async function ebaySearch(params) {
  const url =
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}` +
    `&category_ids=176985` + // Music > Records
    `&filter=${encodeURIComponent("conditions:{USED},priceCurrency:USD")}&limit=50`;
  let res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${ebayToken}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  if (res.status === 401) {
    ebayToken = await getEbayToken(); // expired mid-run — refresh and retry
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${ebayToken}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
    });
  }
  if (!res.ok) return null;
  return (await res.json()).itemSummaries ?? [];
}

// Asking-price stats for used copies on eBay US. When Discogs gives us
// the pressing's barcode we search by UPC (gtin) first — those matches
// are the exact pressing, from sellers who filled in the UPC item
// specific. Otherwise fall back to fuzzy keyword search sanity-filtered
// against artist/title tokens, where the median is the number to trust.
async function fetchEbayPrices(artist, title, barcode) {
  let items = null;
  let exact = false;
  if (barcode) {
    const byUpc = await ebaySearch(`gtin=${encodeURIComponent(barcode)}`);
    if (byUpc && byUpc.length >= 2) {
      items = byUpc;
      exact = true;
    }
  }
  if (!items) {
    const found = await ebaySearch(
      `q=${encodeURIComponent(`${artist} ${title} vinyl`)}`
    );
    if (!found) return null;
    const aTok = searchTokens(artist);
    const tTok = searchTokens(title);
    items = found.filter((it) => {
      const t = (it.title ?? "").toLowerCase();
      return (
        (aTok.length === 0 || aTok.some((w) => t.includes(w))) &&
        (tTok.length === 0 || tTok.some((w) => t.includes(w)))
      );
    });
  }
  const prices = items
    .map((it) => Number(it.price?.value))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) {
    return { lowest: null, median: null, avg: null, max: null, count: 0, exact: false };
  }
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  const avg = prices.reduce((s, v) => s + v, 0) / prices.length;
  return {
    lowest: prices[0],
    median: Number(median.toFixed(2)),
    avg: Number(avg.toFixed(2)),
    max: prices[prices.length - 1],
    count: prices.length,
    exact,
  };
}

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
  if (ebayId && ebaySecret) {
    try {
      ebayToken = await getEbayToken();
      console.log("eBay pricing enabled");
    } catch (e) {
      console.error("eBay disabled:", e.message);
    }
  } else {
    console.log("eBay credentials not set — skipping eBay pricing");
  }

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

  // Rejections should stick: don't re-flag a record when a suggestion
  // within 5% of the same price was rejected in the last 14 days.
  const { data: rejectedRows, error: rejectedErr } = await supabase
    .from("pending_price_changes")
    .select("record_id, suggested_price")
    .eq("status", "rejected")
    .gte(
      "resolved_at",
      new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()
    );
  if (rejectedErr) throw rejectedErr;
  const recentlyRejected = new Map();
  for (const p of rejectedRows) {
    const list = recentlyRejected.get(p.record_id) ?? [];
    list.push(Number(p.suggested_price));
    recentlyRejected.set(p.record_id, list);
  }
  const wasRejected = (recordId, suggested) =>
    (recentlyRejected.get(recordId) ?? []).some(
      (prev) => Math.abs(prev - suggested) / Math.max(prev, 1) <= 0.05
    );

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
      const suggestion = suggestions?.[gradeKey]?.value ?? null;

      // Full release data up front: same request budget as the old
      // marketplace/stats call but also returns community have/want and
      // rating — our demand signals. The lowest listing caps the
      // suggestion target: never suggest raising above lowest − $1.
      await sleep(1100);
      let lowest = null;
      let forSale = null;
      let have = null;
      let want = null;
      let rating = null;
      let barcode = null;
      const relRes = await fetch(
        `https://api.discogs.com/releases/${r.discogs_release_id}?curr_abbr=USD`,
        {
          headers: {
            Authorization: `Discogs token=${discogsToken}`,
            "User-Agent": "LateOnsetAudiophileRecords/1.0",
          },
        }
      );
      if (relRes.ok) {
        const rel = await relRes.json();
        lowest = rel?.lowest_price ?? null;
        forSale = rel?.num_for_sale ?? null;
        have = rel?.community?.have ?? null;
        want = rel?.community?.want ?? null;
        rating = rel?.community?.rating?.average ?? null;
        // The pressing's UPC, when Discogs has it — lets eBay match exactly
        const raw = (rel?.identifiers ?? []).find(
          (i) => i.type === "Barcode"
        )?.value;
        const digits = raw?.replace(/\D/g, "") ?? "";
        if (digits.length >= 8 && digits.length <= 14) barcode = digits;
      }

      let ebay = null;
      if (ebayToken) {
        try {
          ebay = await fetchEbayPrices(r.artist, r.title, barcode);
        } catch (e) {
          console.error(`eBay for ${r.artist} — ${r.title}:`, e.message);
        }
      }

      // Daily market snapshot — our own time series of data Discogs
      // doesn't expose historically (rerunning the same day overwrites).
      const { error: snapErr } = await supabase.from("market_snapshots").upsert(
        {
          record_id: r.id,
          snapped_on: new Date().toISOString().slice(0, 10),
          suggested: suggestion,
          lowest,
          for_sale: forSale,
          have,
          want,
          rating,
          ebay_lowest: ebay?.lowest ?? null,
          ebay_median: ebay?.median ?? null,
          ebay_avg: ebay?.avg ?? null,
          ebay_max: ebay?.max ?? null,
          ebay_count: ebay?.count ?? null,
          ebay_exact: ebay?.exact ?? false,
        },
        { onConflict: "record_id,snapped_on" }
      );
      if (snapErr) console.error(`snapshot for record ${r.id}:`, snapErr.message);

      if (!suggestion) continue; // pricing logic needs a suggestion

      const competitive = lowest
        ? Math.max(Math.round(lowest) - UNDERCUT_BY, 1)
        : null;

      let price = r.price; // tracks changes made within this iteration

      let target = Math.round(suggestion * PRICE_FACTOR);
      if (competitive !== null) target = Math.min(target, competitive);
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
          } else if (!hasPending.has(r.id) && !wasRejected(r.id, target)) {
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
      if (price > 0 && lowest && price > lowest && competitive < price) {
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
          have,
          want,
          ebay_median: ebay?.median ?? null,
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
        } else if (
          !hasPending.has(r.id) &&
          !wasRejected(r.id, competitive)
        ) {
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
    const demand = (s) =>
      s.want != null && s.have != null
        ? `${(s.want / Math.max(s.have, 1)).toFixed(2)}`
        : "?";
    const cutRow = (s) =>
      `<tr><td>${s.artist} — ${s.title}</td><td>$${s.old_price}</td><td>$${s.lowest}</td><td>$${s.new_price}</td><td>${(s.pct * 100).toFixed(1)}%</td><td>${s.for_sale ?? "?"}</td><td>${demand(s)}</td><td>${s.ebay_median != null ? `$${s.ebay_median}` : "—"}</td></tr>`;
    const cutHeader = `<tr><th>Record</th><th>Your price</th><th>Lowest listing</th><th>Suggested</th><th>Cut</th><th>Copies for sale</th><th>Demand (want÷have)</th><th>eBay median (used)</th></tr>`;

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
