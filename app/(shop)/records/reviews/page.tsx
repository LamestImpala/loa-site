import type { Metadata } from "next";
import Link from "next/link";
import { ratingLine, stars } from "@/lib/review";
import { getPublishedReviews, getReviewSummary } from "../data";
import ReviewQuoteItem from "../review-quote";

// Every published review, newest first. The home page quotes three; this
// is where the rest live, so a buyer who left one can always find it
// (each has an id, /reviews#review-<id>, to link straight to it).

export const metadata: Metadata = {
  title: "Reviews — Curiouser Records",
  description:
    "What buyers say about Curiouser Records: every review, in their own words.",
  alternates: { canonical: "/reviews" },
};

export const revalidate = 60;

export default async function ReviewsPage() {
  const [all, summary] = await Promise.all([getPublishedReviews(), getReviewSummary()]);
  // If the full list fails to load, the home page's quotes beat an empty page.
  const reviews = all.length > 0 ? all : (summary?.quotes ?? []);

  return (
    <>
      <header className="shop-shell shop-reviews-head">
        <Link className="shop-reviews-back" href="/">
          ← Back to the records
        </Link>
        <h1>What buyers say</h1>
        {summary ? (
          <p className="shop-rating">
            {summary.average != null ? (
              <span className="shop-rating-stars" aria-hidden="true">
                {stars(summary.average)}
              </span>
            ) : null}
            <span>{ratingLine(summary)}</span>
          </p>
        ) : null}
      </header>

      <section className="shop-shell shop-reviews" aria-label="All reviews">
        {reviews.length > 0 ? (
          <ul className="shop-reviews-list shop-reviews-all">
            {reviews.map((q) => (
              <ReviewQuoteItem key={q.id} quote={q} anchored />
            ))}
          </ul>
        ) : (
          <div className="card shop-empty">
            <div className="shop-empty-title">No reviews here yet.</div>
            <p className="shop-muted" style={{ margin: 0 }}>
              Buyers&rsquo; reviews show up here once they&rsquo;re in.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
