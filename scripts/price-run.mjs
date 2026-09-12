/*
 * Daily Discogs price run.
 *
 * For every listed, unsold record with a Discogs release ID, fetches the
 * Discogs price suggestions (all grades) and the release's market stats,
 * then plans a target price with planPrice():
 *
 *   - Tier factor on the grade suggestion. Scarce-and-wanted releases
 *     (≤SCARCE_MAX_FOR_SALE copies, want/have ≥ SCARCE_MIN_DEMAND) ask the
 *     full suggestion; stocked releases (STOCKED_MIN+ copies) ask
 *     STOCKED_FACTOR; everything else asks PRICE_FACTOR.
 *   - Cheapest listing, gated. Discogs' lowest_price is condition-blind,
 *     country-blind and FX-converted, so a $9 "listing" on a $54 record is
 *     usually a junk copy or a seller who won't ship to the US. It only
 *     counts when it sits at or above the Fair-grade suggestion, and even
 *     then never below the tier floor. A comparable listing caps the target
 *     at lowest − UNDERCUT_BY.
 *   - eBay: when the exact pressing (UPC match) has EBAY_MIN_EXACT+ used
 *     listings, their median asking price caps the target (floored too).
 *   - Time decay: a record unsold for DECAY_AFTER_DAYS with no price change
 *     in DECAY_QUIET_DAYS comes down DECAY_STEP, to the tier floor. Applied
 *     directly — the daily "Drink me" drops on the site come from here.
 *
 * Moves within ±THRESHOLD (and decay steps) apply automatically; bigger
 * moves are queued in pending_price_changes for approval on /admin. Each run
 * is logged to price_runs, and an email report is sent via Resend when
 * anything was flagged (if RESEND_API_KEY is set).
 *
 * Required env: DISCOGS_TOKEN, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: RESEND_API_KEY, EBAY_CLIENT_ID/EBAY_CLIENT_SECRET,
 *   DRY_RUN=1 (plan and print, write nothing), ONLY_IDS=1,2,3 (limit to
 *   these record ids, manual-priced ones included — for spot checks).
 */
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const SUPABASE_URL = "https://spmbjuurarlpyqcqxyyz.supabase.co";
const REPORT_EMAIL = "brandoncgillihan@gmail.com";
export const PRICE_FACTOR = 0.85; // normal releases: ask 85% of the grade suggestion
export const SCARCE_FACTOR = 1.0; // scarce and wanted: the full suggestion
export const STOCKED_FACTOR = 0.7; // stocked releases: commodity copies only move cheap
const THRESHOLD = 0.05; // auto-apply suggestion moves within ±5%
export const UNDERCUT_BY = 1; // competitive price = $1 below a comparable cheapest listing
const MAX_AUTO_CUT = 0.1; // auto-apply competitive cuts up to 10%
// Scarce = few copies for sale AND real demand (wants per existing copy).
export const SCARCE_MAX_FOR_SALE = 5;
export const SCARCE_MIN_DEMAND = 0.4;
export const STOCKED_MIN = 30;
// Floors as a share of the grade suggestion — undercuts, eBay caps and decay
// never go below the tier's floor.
export const FLOOR = { scarce: 0.85, normal: 0.55, stocked: 0.4 };
// Time decay for shelf-sitters.
export const DECAY_AFTER_DAYS = 30;
export const DECAY_QUIET_DAYS = 14;
export const DECAY_STEP = 0.05;
// Only exact-pressing (UPC) eBay matches are trusted as a price cap —
// fuzzy title matches mix every pressing of an album together.
const EBAY_MIN_EXACT = 3;
const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY_IDS = (process.env.ONLY_IDS ?? "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

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
const FAIR_KEY = GRADE_KEY.F;

const discogsToken = process.env.DISCOGS_TOKEN;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pure pricing decision for one record — kept free of I/O so it can be unit
// tested (scripts/price-run.test.mjs). All prices are whole dollars.
export function planPrice({
  price,
  suggestion,
  fairSuggestion = null,
  lowest = null,
  forSale = null,
  want = null,
  have = null,
  ebay = null,
  daysListed = 0,
  daysSinceChange = 0,
}) {
  const demand =
    want != null && have != null ? want / Math.max(have, 1) : null;
  const tier =
    forSale != null &&
    forSale <= SCARCE_MAX_FOR_SALE &&
    demand != null &&
    demand >= SCARCE_MIN_DEMAND
      ? "scarce"
      : forSale != null && forSale >= STOCKED_MIN
        ? "stocked"
        : "normal";
  const factor =
    tier === "scarce"
      ? SCARCE_FACTOR
      : tier === "stocked"
        ? STOCKED_FACTOR
        : PRICE_FACTOR;
  const floor = Math.max(1, Math.round(suggestion * FLOOR[tier]));

  // Is the cheapest listing even the same kind of thing we're selling? A
  // listing below what Discogs expects a Fair copy to fetch is a trashed
  // copy, a mislisted item, or a foreign seller's FX-converted price.
  const plausibleBar = fairSuggestion ?? suggestion * 0.5;
  const lowestPlausible = lowest != null && lowest > 0 && lowest >= plausibleBar;
  const rawCompetitive = lowestPlausible
    ? Math.max(Math.round(lowest) - UNDERCUT_BY, 1)
    : null;
  // Below the tier floor even a comparable listing is treated as noise.
  const competitive =
    rawCompetitive !== null && rawCompetitive >= floor ? rawCompetitive : null;

  const ebayCap =
    ebay?.exact && ebay.count >= EBAY_MIN_EXACT && ebay.median
      ? Math.max(floor, Math.round(ebay.median))
      : null;

  let target = Math.round(suggestion * factor);
  let reason = tier === "normal" ? "suggestion" : tier;
  if (competitive !== null && competitive < target) {
    target = competitive;
    reason = "lowest";
  }
  if (ebayCap !== null && ebayCap < target) {
    target = ebayCap;
    reason = "ebay";
  }

  // Shelf-sitter decay only kicks in when the market rule alone would leave
  // the price where it is (or raise it); a bigger market cut wins outright.
  let decay = false;
  if (
    price > 0 &&
    target >= price &&
    daysListed >= DECAY_AFTER_DAYS &&
    daysSinceChange >= DECAY_QUIET_DAYS
  ) {
    const stepped = Math.min(price - 1, Math.round(price * (1 - DECAY_STEP)));
    const decayed = Math.max(floor, stepped);
    if (decayed < price) {
      target = decayed;
      reason = "decay";
      decay = true;
    }
  }

  return {
    tier,
    floor,
    lowestPlausible,
    competitive,
    ebayCap,
    target: Math.max(1, target),
    reason,
    decay,
  };
}

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
  if (!discogsToken || !serviceKey) {
    console.error("DISCOGS_TOKEN and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }
  supabase = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false },
  });
  if (DRY_RUN) console.log("DRY RUN — nothing will be written");

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

  if (!DRY_RUN) await backfillCoverImages();

  let query = supabase
    .from("records")
    .select("id, artist, title, media, price, discogs_release_id, created_at")
    .eq("listed", true)
    .eq("sold", false)
    .not("discogs_release_id", "is", null);
  // ONLY_IDS is a spot-check mode, so hand-priced records are included;
  // the normal run leaves admin-locked prices alone.
  query = ONLY_IDS.length
    ? query.in("id", ONLY_IDS)
    : query.eq("manual_price", false);
  const { data: records, error } = await query;
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

  // Last price change per record (price_history is trigger-fed on every
  // change) — the decay rule waits DECAY_QUIET_DAYS after any move.
  const { data: historyRows, error: historyErr } = await supabase
    .from("price_history")
    .select("record_id, changed_at")
    .order("changed_at", { ascending: false })
    .range(0, 19999);
  if (historyErr) throw historyErr;
  const lastChange = new Map();
  for (const h of historyRows) {
    if (!lastChange.has(h.record_id)) lastChange.set(h.record_id, h.changed_at);
  }
  const DAY = 24 * 3600 * 1000;
  const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / DAY : 0);

  const summary = [];
  let checked = 0;
  let autoApplied = 0;
  let flagged = 0;
  let aboveLowest = 0;
  let undercuts = 0;
  let decays = 0;
  let implausible = 0;
  let errors = 0;

  let run = { id: null };
  if (!DRY_RUN) {
    const { data, error: runErr } = await supabase
      .from("price_runs")
      .insert({})
      .select()
      .single();
    if (runErr) throw runErr;
    run = data;
  }

  const setPrice = async (id, patch) => {
    if (DRY_RUN) return;
    const { error: updErr } = await supabase
      .from("records")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) throw updErr;
  };
  const queueChange = async (id, oldPrice, newPrice, pct) => {
    if (DRY_RUN) return;
    const { error: insErr } = await supabase.from("pending_price_changes").insert({
      record_id: id,
      run_id: run.id,
      old_price: oldPrice,
      suggested_price: newPrice,
      pct_change: pct,
    });
    if (insErr) throw insErr;
  };

  for (const r of records) {
    try {
      const suggestions = await fetchSuggestion(r.discogs_release_id);
      checked++;
      const gradeKey = GRADE_KEY[r.media];
      const suggestion = suggestions?.[gradeKey]?.value ?? null;
      const fairSuggestion = suggestions?.[FAIR_KEY]?.value ?? null;

      // Full release data up front: same request budget as the old
      // marketplace/stats call but also returns community have/want and
      // rating — our demand signals.
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

      const plan = suggestion
        ? planPrice({
            price: Number(r.price),
            suggestion,
            fairSuggestion,
            lowest,
            forSale,
            want,
            have,
            ebay,
            daysListed: daysSince(r.created_at),
            daysSinceChange: daysSince(lastChange.get(r.id) ?? r.created_at),
          })
        : null;
      if (lowest != null && plan && !plan.lowestPlausible) implausible++;

      // Daily market snapshot — our own time series of data Discogs
      // doesn't expose historically (rerunning the same day overwrites).
      if (!DRY_RUN) {
        const snapshot = {
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
          lowest_plausible: lowest != null && plan ? plan.lowestPlausible : null,
        };
        let { error: snapErr } = await supabase
          .from("market_snapshots")
          .upsert(snapshot, { onConflict: "record_id,snapped_on" });
        if (snapErr && /lowest_plausible/.test(snapErr.message)) {
          // Migration not applied yet — keep the snapshot flowing without it.
          delete snapshot.lowest_plausible;
          ({ error: snapErr } = await supabase
            .from("market_snapshots")
            .upsert(snapshot, { onConflict: "record_id,snapped_on" }));
        }
        if (snapErr) console.error(`snapshot for record ${r.id}:`, snapErr.message);
      }

      if (!plan) continue; // pricing logic needs a suggestion

      let price = Number(r.price); // tracks changes made within this iteration
      const { target, reason, competitive, lowestPlausible } = plan;
      const base = {
        record_id: r.id,
        artist: r.artist,
        title: r.title,
        lowest: lowest ? Math.round(lowest) : null,
        lowest_plausible: lowest != null ? lowestPlausible : undefined,
        for_sale: forSale,
        have,
        want,
        ebay_median: ebay?.median ?? null,
      };

      if (target !== price) {
        const entry = { ...base, old_price: price, new_price: target, reason };
        if (price === 0) {
          // new record with no price yet — set it directly
          await setPrice(r.id, { price: target });
          autoApplied++;
          price = target;
          summary.push({ ...entry, pct: 0, action: "applied" });
        } else {
          const pct = Number(((target - price) / price).toFixed(4));
          if (Math.abs(pct) <= THRESHOLD || reason === "decay") {
            await setPrice(r.id, { price: target });
            autoApplied++;
            if (reason === "decay") decays++;
            price = target;
            summary.push({ ...entry, pct, action: "applied" });
          } else if (!hasPending.has(r.id) && !wasRejected(r.id, target)) {
            await queueChange(r.id, price, target, pct);
            hasPending.add(r.id);
            flagged++;
            summary.push({ ...entry, pct, action: "flagged" });
          }
        }
      }

      // Competitive check: are we still above a comparable cheapest Discogs
      // listing? Undercut it by $1 — automatically when the cut is small
      // (≤MAX_AUTO_CUT); otherwise queue it for approval. competitive is
      // already null when the listing isn't comparable or the cut would
      // breach the tier floor.
      if (price > 0 && competitive !== null && competitive < price) {
        aboveLowest++;
        const cutPct = Number(((competitive - price) / price).toFixed(4));
        const entry = { ...base, old_price: price, new_price: competitive, pct: cutPct };
        if (Math.abs(cutPct) <= MAX_AUTO_CUT) {
          await setPrice(r.id, { price: competitive, prev_price: price });
          undercuts++;
          summary.push({ ...entry, action: "undercut" });
        } else if (!hasPending.has(r.id) && !wasRejected(r.id, competitive)) {
          await queueChange(r.id, price, competitive, cutPct);
          hasPending.add(r.id);
          summary.push({ ...entry, action: "above-lowest" });
        }
      }

      if (DRY_RUN) {
        console.log(
          `${r.artist} — ${r.title}: $${r.price} → $${target} [${plan.tier}/${reason}]` +
            ` sugg $${Math.round(suggestion)} fair $${fairSuggestion ? Math.round(fairSuggestion) : "?"}` +
            ` lowest ${lowest != null ? `$${lowest}${lowestPlausible ? "" : " (not comparable)"}` : "—"}` +
            ` for sale ${forSale ?? "?"} floor $${plan.floor}`
        );
      }
    } catch (e) {
      errors++;
      console.error(`${r.artist} — ${r.title}:`, e.message);
    }
    await sleep(1100); // Discogs allows 60 requests/minute
  }

  if (!DRY_RUN) {
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
  }

  console.log(
    `Done: ${checked} checked, ${autoApplied} auto-applied (${decays} decay steps), ${undercuts} undercuts, ${flagged} flagged, ${aboveLowest} above a comparable listing, ${implausible} cheapest listings ignored as not comparable, ${errors} errors`
  );

  const pendingCuts = summary.filter((s) => s.action === "above-lowest");
  if (
    !DRY_RUN &&
    (flagged > 0 || undercuts > 0 || pendingCuts.length > 0) &&
    process.env.RESEND_API_KEY
  ) {
    const REASON_LABEL = {
      suggestion: "85% of grade suggestion",
      scarce: "scarce & wanted — full suggestion",
      stocked: "stocked release (30+ copies) — 70% of suggestion",
      lowest: "$1 under a comparable cheapest listing",
      ebay: "capped at eBay median for this pressing",
      decay: "unsold 30+ days — 5% time decay",
    };
    const suggestionRows = (action) =>
      summary
        .filter((s) => s.action === action)
        .map(
          (s) =>
            `<tr><td>${s.artist} — ${s.title}</td><td>$${s.old_price}</td><td>$${s.new_price}</td><td>${(s.pct * 100).toFixed(1)}%</td><td>${REASON_LABEL[s.reason] ?? "—"}</td><td>${s.lowest != null ? `$${s.lowest}${s.lowest_plausible === false ? " (ignored)" : ""}` : "—"}</td><td>${s.for_sale ?? "?"}</td><td>${s.ebay_median != null ? `$${s.ebay_median}` : "—"}</td></tr>`
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
        ? `<p>These moved more than ±5% and are waiting for your approval at
<a href="https://www.lateonsetaudiophile.com/admin">lateonsetaudiophile.com/admin</a>:</p>
<table border="1" cellpadding="6" cellspacing="0">
<tr><th>Record</th><th>Current</th><th>Suggested</th><th>Change</th><th>Why</th><th>Lowest listing</th><th>Copies for sale</th><th>eBay median (used)</th></tr>
${suggestionRows("flagged")}
</table>`
        : "";

    const sortedCuts = [...pendingCuts].sort((a, b) => a.pct - b.pct);
    const cutsSection =
      sortedCuts.length > 0
        ? `<p>These are priced <strong>above a comparable cheapest Discogs listing</strong>
(one at or above the Fair-grade suggestion — junk-grade and foreign-only listings are already filtered out).
One-click Approve at <a href="https://www.lateonsetaudiophile.com/admin">lateonsetaudiophile.com/admin</a>
sets the suggested price ($1 under that listing).</p>
<table border="1" cellpadding="6" cellspacing="0">${cutHeader}${sortedCuts.map(cutRow).join("")}</table>`
        : "";

    const undercutSection =
      undercuts > 0
        ? `<p>Auto-undercut to $1 below a comparable cheapest listing (cut ≤10% and above the tier floor):</p>
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
        subject: `Price run: ${undercuts} auto-undercut, ${decays} decay steps, ${flagged + pendingCuts.length} awaiting approval`,
        html: `<p>${checked} records checked, ${autoApplied} changes auto-applied (${decays} of them time-decay steps), ${undercuts} competitive undercuts applied, ${implausible} cheapest listings ignored as not comparable.</p>
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

// Only run when executed directly — the test file imports planPrice.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
