import { NextRequest, NextResponse, after } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { adminReviewNotificationEmail, parseReviewBody } from "@/lib/review";
import { emailConfigured, sendEmail } from "@/lib/email";

// A buyer's review from /review/<token>. Unauthenticated by design: the
// token is the credential. The anon role can't touch shop_reviews; the
// submit_shop_review() function checks the link (exists, unused), the
// input, and a flood cap, then saves the review as pending. The admin
// notification goes out after the response and is best-effort.

export async function POST(req: NextRequest) {
  const parsed = parseReviewBody(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if ("honeypot" in parsed) return new Response(null, { status: 204 });
  const { token, rating, body, name } = parsed.review;

  const { error } = await createServerSupabase().rpc("submit_shop_review", {
    p_token: token,
    p_rating: rating,
    p_body: body,
    p_name: name,
  });
  if (error) {
    const msg = error.message || "";
    if (/rate limited/i.test(msg)) {
      return NextResponse.json(
        { error: "Too many reviews right now — please try again in a bit." },
        { status: 429 }
      );
    }
    if (/already used/i.test(msg)) {
      return NextResponse.json(
        { error: "A review was already left with this link. Thank you!" },
        { status: 409 }
      );
    }
    if (/invalid link/i.test(msg)) {
      return NextResponse.json({ error: "This review link isn't valid" }, { status: 404 });
    }
    if (/invalid review/i.test(msg)) {
      return NextResponse.json({ error: "Add a rating, a few words, and a name" }, { status: 400 });
    }
    console.error("review submit failed:", msg);
    return NextResponse.json({ error: "Couldn't save the review" }, { status: 502 });
  }

  after(async () => {
    if (!emailConfigured()) return;
    const sent = await sendEmail(adminReviewNotificationEmail({ rating, body, name }));
    if (!sent.ok) console.error("review: admin email failed:", sent.error);
  });

  return NextResponse.json({ ok: true });
}
