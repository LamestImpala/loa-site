import type { OrderRequest, ShopMessage } from "../supabase.ts";
import { REF_LINE_RE } from "../records.ts";

// Inbound mail for the admin Inbox: pull out the ref code that ties a
// message to a saved request, and a one-line summary of the body. Pure.

// "Ref: CR-XXXX" anywhere in the subject or body, else a bare CR-XXXX in
// the subject (replies often keep only "Re: … (Ref CR-XXXX)").
const BARE_REF_RE = /\b(CR-[A-HJ-NP-Z2-9]{4})\b/i;

export function findRefCode(subject: string | null, text: string | null): string | null {
  for (const s of [subject ?? "", text ?? ""]) {
    const m = s.match(REF_LINE_RE) ?? s.match(BARE_REF_RE);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export function requestForRef(
  refCode: string | null,
  requests: Pick<OrderRequest, "id" | "ref_code">[]
): number | null {
  if (!refCode) return null;
  return requests.find((r) => r.ref_code.toUpperCase() === refCode)?.id ?? null;
}

// Plain text from an email body: the text part when there is one, else the
// HTML with tags, styles and scripts stripped. Never rendered as HTML.
export function bodyText(m: Pick<ShopMessage, "text_body" | "html_body">): string {
  if (m.text_body?.trim()) return m.text_body.replace(/\r\n/g, "\n").trim();
  const html = m.html_body ?? "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n|\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// The gist for a card: the first lines before any quoted reply, collapsed
// to one line and capped.
export function messageSummary(
  m: Pick<ShopMessage, "text_body" | "html_body">,
  max = 300
): string {
  const text = bodyText(m)
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join(" ")
    .replace(/\bOn .{10,120}? wrote:[\s\S]*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Subject for a reply, threading the way mail clients do.
export function replySubject(subject: string | null): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: your record request";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}
