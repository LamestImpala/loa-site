import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SELLER_INFO } from "@/lib/records";
import { trackRecordLine } from "@/lib/record-info";
import { getListedByKind, getListedItems, getRedditPostUrl, getShopStats } from "../data";
import ItemsClient from "../items-client";

export const metadata: Metadata = {
  title: "Audio Equipment for Sale — Curiouser Records",
  description:
    "Turntables, amplifiers and other hi-fi gear from my own system — tested before listing, described honestly, shipped boxed or picked up in Phoenix.",
  alternates: { canonical: "/equipment" },
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
        <strong>Shipping:</strong> {SELLER_INFO.gearShipping}
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

export default async function EquipmentPage() {
  const [{ items: gear, error }, { items: all }, redditPostUrl, stats] = await Promise.all([
    getListedByKind("gear"),
    getListedItems(),
    getRedditPostUrl(),
    getShopStats(),
  ]);
  const trackRecord = trackRecordLine(stats);

  return (
    <>
      <header className="shop-shell shop-hero">
        <div className="shop-hero-copy">
          <p className="shop-hero-kicker">Phoenix, Arizona · out of my own rack</p>
          <h1>
            <em>Audio equipment</em> that&rsquo;s earned its keep.
          </h1>
          <p className="shop-hero-lede">
            Turntables, amps and the odd accessory I&rsquo;ve upgraded past. Each one was running
            in my system before it was listed; what works, what&rsquo;s included and any quirks
            are written up on its page. I write about this gear at{" "}
            <Link href="https://lateonsetaudiophile.com">Late Onset Audiophile</Link>.
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
            Browse the equipment ↓
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
            <div className="shop-empty-title">The equipment list didn&rsquo;t load.</div>
            <p className="shop-muted" style={{ margin: 0 }}>
              Please check back in a minute, or email{" "}
              <a href={`mailto:${SELLER_INFO.contactEmail}`}>{SELLER_INFO.contactEmail}</a>.
            </p>
          </div>
        </div>
      ) : (
        <ItemsClient kind="gear" items={gear} bundlePool={all} redditPostUrl={redditPostUrl} />
      )}
    </>
  );
}
