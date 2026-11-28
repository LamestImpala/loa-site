import type { Metadata } from "next";
import { GardenWall, ShopHero } from "../shop-hero";
import { BuyingStrip, BuyingTerms, HowBuyingWorksLink } from "../buying-terms";
import { SELLER_INFO } from "@/lib/records";
import { isReduced, trackRecordLine } from "@/lib/record-info";
import Link from "next/link";
import { ratingLine, stars, type ReviewSummary } from "@/lib/review";
import {
  getDiscStyles,
  getListedItems,
  getListedRecords,
  getRedditPostUrl,
  getReviewSummary,
  getShopStats,
  getTopShelfIds,
} from "../data";
import RecordsClient from "../records-client";
import ReviewQuoteItem from "../review-quote";

export const metadata: Metadata = {
  title: "Records for Sale — Curiouser Records",
  description:
    "Vinyl records for sale from my personal collection. Graded to the Goldmine standard, shipped in proper LP mailers.",
  alternates: { canonical: "/" },
};

export const revalidate = 60;

// More published than the three quoted here: link to the full list.
function hasMoreReviews(s: ReviewSummary) {
  return s.count > s.quotes.length;
}

// "★★★★★ 4.9 out of 5 from 23 reviews · Read them ↓", in the hero band on
// every screen size so the rating is seen before the listings. When some
// aren't quoted below, "Read them" goes to the full /reviews page.
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
// and a link to the rest. Under the listings: the hero's rating line is the
// summary, and the records come before the testimonials.
function ReviewQuotes({ summary }: { summary: ReviewSummary }) {
  return (
    <section
      className="shop-shell shop-reviews"
      id="reviews"
      aria-labelledby="reviews-title"
    >
      <h2 id="reviews-title">What buyers say</h2>
      <ul className="shop-reviews-list">
        {summary.quotes.map((q) => (
          <ReviewQuoteItem key={q.id} quote={q} clamp />
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
  const [
    { records: listed, error },
    { items: all },
    redditPostUrl,
    stats,
    reviews,
    discStyles,
    topShelfIds,
  ] = await Promise.all([
    getListedRecords(),
    getListedItems(),
    getRedditPostUrl(),
    getShopStats(),
    getReviewSummary(),
    getDiscStyles(),
    getTopShelfIds(),
  ]);
  const topShelf = new Set(topShelfIds);
  const records = listed.map((r) => (topShelf.has(r.id) ? { ...r, top_shelf: true } : r));
  const trackRecord = trackRecordLine(stats);
  // The "Drink me" and "Top Shelf" tags are only explained while a record is
  // wearing one.
  const hasDrops = records.some((r) => !r.sold && isReduced(r));
  const hasTopShelf = records.some((r) => !r.sold && r.top_shelf);

  return (
    <>
      <ShopHero>
        <p className="shop-hero-kicker">
          Phoenix, Arizona · a one-person record shop
        </p>
        <h1>
          <em>Curiouser and curiouser</em> finds for your turntable.
        </h1>
        <div className="shop-hero-meta">
          {reviews ? <RatingLine summary={reviews} /> : null}
          <HowBuyingWorksLink />
        </div>
      </ShopHero>

      <GardenWall>
        <BuyingStrip kind="record" />

        {error ? (
          <div className="shop-shell shop-main">
            <div className="card shop-empty">
              <div className="shop-empty-title">
                The record list didn&rsquo;t load.
              </div>
              <p className="shop-muted" style={{ margin: 0 }}>
                Please check back in a minute, or email{" "}
                <a href={`mailto:${SELLER_INFO.contactEmail}`}>
                  {SELLER_INFO.contactEmail}
                </a>
                .
              </p>
            </div>
          </div>
        ) : (
          <RecordsClient
            records={records}
            discStyles={discStyles}
            bundlePool={all}
            redditPostUrl={redditPostUrl}
          />
        )}

        {reviews && reviews.quotes.length > 0 ? (
          <ReviewQuotes summary={reviews} />
        ) : null}

        <BuyingTerms kind="record" trackRecord={trackRecord}>
          Every record here is from my own shelves, graded to the{" "}
          <a
            href="https://www.discogs.com/selling/resources/how-to-grade-items/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Goldmine standard
          </a>
          , with live Discogs pricing.
          {hasDrops ? (
            <>
              {" "}
              Spot a &ldquo;Drink me&rdquo; tag? That&rsquo;s a real price
              drop since yesterday.
            </>
          ) : null}
          {hasTopShelf ? (
            <>
              {" "}
              &ldquo;Top Shelf&rdquo; records are the ones I reach for first,
              priced at what it would take for me to let them go, not at
              market.
            </>
          ) : null}
        </BuyingTerms>
      </GardenWall>
    </>
  );
}
