import type { Order, Shipment, ShipTo } from "../supabase.ts";
import { SELLER_INFO } from "../records.ts";

// Label intake rules: turn the text of a USPS label PDF into a tracking
// number and a recipient, and match that to a sealed box. Pure — the
// PDF reading happens in the browser (app/admin/_labels/pdf-text.ts) and
// hands in plain text items, so this is testable on synthetic lines.

export type TextItemLike = { str: string; transform: number[] };

// pdf.js gives text as positioned fragments. Group them into lines by
// their y (rounded to the nearest 2pt), left to right, top to bottom.
export function linesFromItems(items: TextItemLike[]): string[] {
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform?.[4] ?? 0;
    const y = Math.round((it.transform?.[5] ?? 0) / 2) * 2;
    const row = rows.get(y);
    if (row) row.push({ x, str: it.str });
    else rows.set(y, [{ x, str: it.str }]);
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, frags]) =>
      frags
        .sort((a, b) => a.x - b.x)
        .map((f) => f.str.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

// USPS IMpb numbers: 20–34 digits starting 92–95, printed in groups of
// four ("9400 1112 ..."). The barcode's text form sometimes carries a
// "420" + ZIP prefix. Prefer the number printed under a "TRACKING" line,
// then the usual 22-digit form.
export function findTracking(lines: string[]): string | null {
  const trackingLine = lines.findIndex((l) => /TRACKING/i.test(l));
  const found: { digits: string; line: number }[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?:\d[ \t]?){20,40}/g)) {
      let digits = m[0].replace(/\D/g, "");
      if (/^420\d{5}9[2-5]/.test(digits) && digits.length >= 28) digits = digits.slice(8);
      if (/^9[2-5]\d{18,32}$/.test(digits)) found.push({ digits, line: i });
    }
  });
  if (found.length === 0) return null;
  const rank = (c: { digits: string; line: number }) =>
    (trackingLine >= 0 && c.line > trackingLine && c.line - trackingLine <= 3 ? 0 : 2) +
    (c.digits.length === 22 ? 0 : 1);
  return [...found].sort((a, b) => rank(a) - rank(b) || a.line - b.line)[0].digits;
}

// Label keywords that are never a person's name.
const NOISE =
  /USPS|TRACKING|MEDIA MAIL|PRIORITY|FIRST[- ]CLASS|GROUND ADVANTAGE|SHIP\s*TO|SHIP\s*FROM|RETURN|POSTAGE|PAID|ELECTRONIC RATE|COMMERCIAL|EXPECTED DELIVERY|ZONE|LBS?\b|OZ\b|DELIVERY|SIGNATURE|CUSTOMS|PAYPAL|SHIPSTATION|WEIGHT|SERVICE|#\s*\d/i;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const sellerNames = [SELLER_INFO.redditUsername, "curiouser records", SELLER_INFO.location].map(
  normalize
);

const isStreetLine = (l: string) => /^\d+[a-z]?\s+\S/i.test(l) || /\bP\.?O\.? BOX\b/i.test(l);
const isPlaceLine = (l: string) => /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(l);

// Lines that could be the recipient's name: the block after "SHIP TO"
// up to the street line, or, without that marker, every line that isn't
// obviously an address, a label keyword, or the seller. Two passes keep
// the strong signal first.
export function recipientCandidates(lines: string[]): string[] {
  const out: string[] = [];
  const push = (l: string) => {
    const n = normalize(l);
    if (!n || n.length < 3) return;
    if (sellerNames.some((s) => s && n.includes(s))) return;
    if (!out.includes(l)) out.push(l);
  };
  const shipTo = lines.findIndex((l) => /SHIP\s*TO\b/i.test(l));
  if (shipTo >= 0) {
    // The name can share the "SHIP TO:" line.
    const same = lines[shipTo].replace(/.*SHIP\s*TO:?/i, "").trim();
    if (same) push(same);
    for (let i = shipTo + 1; i < Math.min(lines.length, shipTo + 5); i++) {
      const l = lines[i];
      if (isStreetLine(l) || isPlaceLine(l)) break;
      if (NOISE.test(l)) continue;
      push(l);
    }
  }
  for (const l of lines) {
    if (NOISE.test(l) || isStreetLine(l) || isPlaceLine(l) || /\d{4}/.test(l)) continue;
    push(l);
  }
  return out;
}

// Every ZIP on the label, in order; the seller's own return-address ZIP
// is among them, which is harmless (no order ships to it).
export function postalCodes(lines: string[]): string[] {
  const zips: string[] = [];
  for (const l of lines) {
    for (const m of l.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)) {
      if (!zips.includes(m[1])) zips.push(m[1]);
    }
  }
  return zips;
}

export type ExtractedLabel = {
  tracking: string | null;
  recipients: string[];
  postalCodes: string[];
};

export function extractLabel(lines: string[]): ExtractedLabel {
  return {
    tracking: findTracking(lines),
    recipients: recipientCandidates(lines),
    postalCodes: postalCodes(lines),
  };
}

export type LabelCandidate = {
  shipment: Shipment;
  order: Order | null;
  buyer: string;
};

export type LabelMatch = { candidate: LabelCandidate; score: number };

function shipToOf(c: LabelCandidate): Partial<ShipTo> | null {
  const snap = c.shipment.to_address as Partial<ShipTo> | null | undefined;
  if (snap && (snap.name || snap.postal_code)) return snap;
  return c.order?.ship_to ?? null;
}

// Score each open box against what the label says: the full ship-to
// name (4), the ZIP (3), the surname (2), the Reddit handle appearing
// anywhere (1). Confident when the best beats the runner-up by 2 or more.
export function matchParcel(
  extracted: Pick<ExtractedLabel, "recipients" | "postalCodes">,
  candidates: LabelCandidate[]
): { best: LabelCandidate | null; confident: boolean; ranked: LabelMatch[] } {
  const recips = extracted.recipients.map(normalize);
  const haystack = recips.join(" | ");
  const ranked: LabelMatch[] = candidates.map((candidate) => {
    let score = 0;
    const shipTo = shipToOf(candidate);
    const name = normalize(shipTo?.name ?? "");
    if (name) {
      if (recips.some((r) => r === name)) score += 4;
      else {
        const parts = name.split(" ").filter((p) => p.length >= 3);
        const last = parts[parts.length - 1];
        if (last && recips.some((r) => r.split(" ").includes(last))) score += 2;
      }
    }
    const zip = (shipTo?.postal_code ?? "").slice(0, 5);
    if (zip && extracted.postalCodes.includes(zip)) score += 3;
    const buyer = normalize(candidate.buyer);
    if (buyer.length >= 3 && haystack.includes(buyer)) score += 1;
    return { candidate, score };
  });
  ranked.sort((a, b) => b.score - a.score || a.candidate.shipment.id - b.candidate.shipment.id);
  const best = ranked[0]?.score > 0 ? ranked[0].candidate : null;
  const runnerUp = ranked[1]?.score ?? 0;
  return {
    best,
    confident: !!best && ranked[0].score - runnerUp >= 2,
    ranked,
  };
}
