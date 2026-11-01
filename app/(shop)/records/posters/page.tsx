import type { Metadata } from "next";
import Image from "next/image";
import { SELLER_INFO } from "@/lib/records";
import { trackRecordLine } from "@/lib/record-info";
import { getListedByKind, getListedItems, getRedditPostUrl, getShopStats } from "../data";
import ItemsClient from "../items-client";

export const metadata: Metadata = {
  title: "Pearl Jam Concert Posters — Curiouser Records",
  description:
    "Pearl Jam concert posters from my own wall — show posters by the artists who made them, stored flat, shipped rolled in a tube.",
  alternates: { canonical: "/posters" },
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
        <strong>Shipping:</strong> {SELLER_INFO.posterShipping} Bundle records too and each
        ships its own way.
      </div>
      <div>
        <strong>Not as described?</strong> Email me and I&rsquo;ll make it right.
      </div>
      {trackRecord ? (
        <div>
          <strong>Track record:</strong> {trackRecord}, every one packed by me.
        </div>
      ) : null}
    </>
  );
}

export default async function PostersPage() {
  const [{ items: posters, error }, { items: all }, redditPostUrl, stats] = await Promise.all([
    getListedByKind("poster"),
    getListedItems(),
    getRedditPostUrl(),
    getShopStats(),
  ]);
  const trackRecord = trackRecordLine(stats);

  return (
    <>
      <header className="shop-shell shop-hero">
        <div className="shop-hero-copy">
          <p className="shop-hero-kicker">Phoenix, Arizona · from the wall, not a warehouse</p>
          <h1>
            <em>Pearl Jam</em> show posters.
          </h1>
          <p className="shop-hero-lede">
            Concert posters I bought at the shows or from the artists who drew them, kept flat
            and out of the sun. Venue, date, edition and size are listed on every one; the
            photos are of the actual print.
          </p>
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
            Browse the posters ↓
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

      {error ? (
        <div className="shop-shell shop-main">
          <div className="card shop-empty">
            <div className="shop-empty-title">The poster list didn&rsquo;t load.</div>
            <p className="shop-muted" style={{ margin: 0 }}>
              Please check back in a minute, or email{" "}
              <a href={`mailto:${SELLER_INFO.contactEmail}`}>{SELLER_INFO.contactEmail}</a>.
            </p>
          </div>
        </div>
      ) : (
        <ItemsClient kind="poster" items={posters} bundlePool={all} redditPostUrl={redditPostUrl} />
      )}
    </>
  );
}
