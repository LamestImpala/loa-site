import type { Metadata } from "next";
import Image from "next/image";
import { SELLER_INFO } from "@/lib/records";
import { trackRecordLine } from "@/lib/record-info";
import Link from "next/link";
import { ratingLine, stars, type ReviewSummary } from "@/lib/review";
import { getListedRecords, getRedditPostUrl, getReviewSummary, getShopStats } from "../data";
import RecordsClient from "../records-client";
import ReviewQuoteItem from "../review-quote";

export const metadata: Metadata = {
  title: "Records for Sale — Curiouser Records",
  description:
    "Vinyl records for sale from my personal collection. Graded to the Goldmine standard, shipped in proper LP mailers.",
  alternates: { canonical: "/" },
};

export const revalidate = 60;

function SellerInfoLines({ trackRecord }: { trackRecord: string | null }) {
  return (
    <>
      <div>
        <strong>Contact:</strong> {SELLER_INFO.contact}
      </div>
      <div>
        <strong>Payment:</strong> {SELLER_INFO.payment}
      </div>
      <div>
        <strong>Shipping:</strong> {SELLER_INFO.shipping}
      </div>
      <div>
        <strong>Not as described?</strong> Email me and I&rsquo;ll make it
        right.
      </div>
      {trackRecord ? (
        <div>
          <strong>Track record:</strong> {trackRecord}, every one graded and
          packed by me.
        </div>
      ) : null}
    </>
  );
}

// More published than the three quoted here: link to the full list.
function hasMoreReviews(s: ReviewSummary) {
  return s.count > s.quotes.length;
}

// "★★★★★ 4.9 out of 5 from 23 reviews · Read them ↓", under the lede on
// every screen size so the rating is seen before the buying details. When
// some aren't quoted below, "Read them" goes to the full /reviews page.
function RatingLine({ summary }: { summary: ReviewSummary }) {
  return (
    <p className="shop-rating">
      {summary.average != null ? (
        <span className="shop-rating-stars" aria-hidden="true">
          {stars(summary.average)}
        </span>
      ) : null}
      <span>{ratingLine(summary)}</span>
      {hasMoreReviews(summary) ? (
        <Link href="/reviews">Read them →</Link>
      ) : (
        <a href="#reviews">Read them ↓</a>
      )}
    </p>
  );
}

// Up to three published reviews, featured first — the buyer's own words —
// and a link to the rest.
function ReviewQuotes({ summary }: { summary: ReviewSummary }) {
  return (
    <section className="shop-shell shop-reviews" id="reviews" aria-labelledby="reviews-title">
      <h2 id="reviews-title">What buyers say</h2>
      <ul className="shop-reviews-list">
        {summary.quotes.map((q) => (
          <ReviewQuoteItem key={q.id} quote={q} />
        ))}
      </ul>
      {hasMoreReviews(summary) ? (
        <Link className="btn btn-secondary shop-reviews-more" href="/reviews">
          See all {summary.count} reviews →
        </Link>
      ) : null}
    </section>
  );
}

export default async function RecordsPage() {
  const [{ records, error }, redditPostUrl, stats, reviews] = await Promise.all([
    getListedRecords(),
    getRedditPostUrl(),
    getShopStats(),
    getReviewSummary(),
  ]);
  const trackRecord = trackRecordLine(stats);

  return (
    <>
      <header className="shop-shell shop-hero">
        <div className="shop-hero-copy">
          <p className="shop-hero-kicker">Phoenix, Arizona · a one-person record shop</p>
          <h1>
            <em>Curiouser and curiouser</em> finds for your turntable.
          </h1>
          <p className="shop-hero-lede">
            Every record here is from my own shelves, graded to the{" "}
            <a
              href="https://www.discogs.com/selling/resources/how-to-grade-items/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Goldmine standard
            </a>
            , with live Discogs pricing. Spot a &ldquo;Drink me&rdquo; tag?
            That&rsquo;s a real price drop since yesterday.
          </p>
          {reviews ? <RatingLine summary={reviews} /> : null}
          {/* Same info twice: always open on desktop, a collapsed <details>
              on phones so records surface within ~1.5 screens. */}
          <div className="shop-hero-info shop-hero-info-static">
            <SellerInfoLines trackRecord={trackRecord} />
          </div>
          <details className="shop-hero-info shop-hero-info-details">
            <summary>How buying works — payment &amp; shipping</summary>
            <div className="shop-hero-info-detail-body">
              <SellerInfoLines trackRecord={trackRecord} />
            </div>
          </details>
          <a className="btn btn-primary shop-hero-cta" href="#records">
            Browse the records ↓
          </a>
        </div>
        <div className="shop-hero-art">
          <Image
            src="/images/curiouserlogo.png"
            alt="Curiouser Records — the White Rabbit with his pocket watch"
            width={260}
            height={260}
            priority
            className="shop-hero-logo"
          />
        </div>
      </header>

      {reviews && reviews.quotes.length > 0 ? <ReviewQuotes summary={reviews} /> : null}

      {error ? (
        <div className="shop-shell shop-main">
          <div className="card shop-empty">
            <div className="shop-empty-title">The record list didn&rsquo;t load.</div>
            <p className="shop-muted" style={{ margin: 0 }}>
              Please check back in a minute, or email{" "}
              <a href={`mailto:${SELLER_INFO.contactEmail}`}>{SELLER_INFO.contactEmail}</a>.
            </p>
          </div>
        </div>
      ) : (
        <RecordsClient records={records} redditPostUrl={redditPostUrl} />
      )}
    </>
  );
}
