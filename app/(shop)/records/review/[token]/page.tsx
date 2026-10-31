import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase";
import { isReviewToken } from "@/lib/review";
import ReviewForm from "./review-form";

// A buyer's private review link, emailed after their box goes out or
// pasted into a Reddit DM. The token is checked by review_invite_info(),
// which returns only a first name for the greeting and whether the link
// was used. Always fresh, so a used link shows the thank-you right away.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leave a review — Curiouser Records",
  robots: { index: false, follow: false },
};

async function loadInvite(token: string) {
  if (!isReviewToken(token)) return null;
  const { data, error } = await createServerSupabase()
    .rpc("review_invite_info", { p_token: token.toLowerCase() })
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { first_name: string | null; used: boolean };
  return { firstName: row.first_name, used: row.used };
}

export default async function ReviewPage({ params }: PageProps<"/records/review/[token]">) {
  const { token } = await params;
  const invite = await loadInvite(token);

  if (!invite || invite.used) {
    return (
      <div className="shop-shell shop-main">
        <div className="card shop-empty">
          <h1 className="shop-empty-title">
            {invite ? "Thank you — your review is in." : "That review link didn’t work."}
          </h1>
          <p className="shop-muted" style={{ margin: 0 }}>
            {invite
              ? "It shows on the shop once I’ve had a look. I appreciate you taking the time."
              : "It may be mistyped. Reply to the email it came in and I’ll send a fresh one."}
          </p>
          <Link className="btn btn-primary" href="/">
            Browse the records
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="shop-shell shop-main">
      <div className="card review-card">
        <p className="shop-hero-kicker">Curiouser Records · a one-person record shop</p>
        <h1 className="review-title">
          {invite.firstName ? `How did it go, ${invite.firstName}?` : "How did it go?"}
        </h1>
        <p className="review-lede">
          A couple of sentences about the grading, the packing, or the records
          themselves helps other collectors trust a small shop. If something
          wasn&rsquo;t right, you can also just reply to my email and I&rsquo;ll
          make it right.
        </p>
        <ReviewForm token={token.toLowerCase()} defaultName={invite.firstName ?? ""} />
      </div>
    </div>
  );
}
