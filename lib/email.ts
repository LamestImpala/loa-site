// Outbound mail and the Resend receiving API, with plain fetch — the same
// call scripts/price-run.mjs makes. The sender is orders@curiouserrecords.com
// once that domain is verified in Resend (RESEND_FROM); until then the
// shared test sender, which can only reach the account owner.
//
// Nothing here throws: a missing key or a failed send comes back as
// { ok: false } so a request is never lost because the email didn't go.

export const ORDERS_ADDRESS = "orders@curiouserrecords.com";
const DEFAULT_FROM = "Curiouser Records <onboarding@resend.dev>";
const API = "https://api.resend.com";

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom(): string {
  return process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
}

// The bare address inside "Name <addr>" (or the string itself).
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendEmail(args: SendEmailArgs): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  try {
    const res = await fetch(`${API}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        text: args.text,
        html: args.html,
        reply_to: args.replyTo,
        headers: args.headers,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: body.message || `Resend ${res.status}` };
    }
    return { ok: true, id: body.id ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

// A received email, as GET /emails/receiving/{id} returns it. The webhook
// carries only metadata; this is where the body comes from.
export type ReceivedEmail = {
  id: string;
  from: string; // "Name <addr>" or a bare address
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  headers?: Record<string, string>;
  message_id: string | null;
  created_at: string;
};

export async function fetchReceivedEmail(
  id: string
): Promise<{ ok: true; email: ReceivedEmail } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set" };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return { ok: false, error: "bad email id" };
  try {
    const res = await fetch(`${API}/emails/receiving/${id}?html_format=cid`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json().catch(() => null)) as
      | (ReceivedEmail & { message?: string })
      | null;
    if (!res.ok || !body) {
      return { ok: false, error: body?.message || `Resend ${res.status}` };
    }
    return { ok: true, email: body };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

// Split "Jane Doe <jane@example.com>" into its parts; a bare address has
// no name. Used to file inbound mail and to greet the sender in a reply.
export function parseAddress(raw: string): { name: string | null; email: string } {
  const m = raw.trim().match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  return { name: null, email: raw.trim().toLowerCase() };
}
