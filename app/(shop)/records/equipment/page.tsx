import type { Metadata } from "next";
import { GardenWall, ShopHero } from "../shop-hero";
import { BuyingStrip, BuyingTerms, HowBuyingWorksLink } from "../buying-terms";
import Link from "next/link";
import { SELLER_INFO } from "@/lib/records";
import { trackRecordLine } from "@/lib/record-info";
import {
  getListedByKind,
  getListedItems,
  getRedditPostUrl,
  getShopStats,
} from "../data";
import ItemsClient from "../items-client";

export const metadata: Metadata = {
  title: "Audio Equipment for Sale — Curiouser Records",
  description:
    "Turntables, amplifiers and other hi-fi gear from my own system — tested before listing, described honestly, shipped boxed or picked up in Phoenix.",
  alternates: { canonical: "/equipment" },
};

export const revalidate = 60;

export default async function EquipmentPage() {
  const [{ items: gear, error }, { items: all }, redditPostUrl, stats] =
    await Promise.all([
      getListedByKind("gear"),
      getListedItems(),
      getRedditPostUrl(),
      getShopStats(),
    ]);
  const trackRecord = trackRecordLine(stats);

  return (
    <>
      <ShopHero>
        <p className="shop-hero-kicker">
          Phoenix, Arizona · out of my own rack
        </p>
        <h1>
          <em>Audio equipment</em> that&rsquo;s earned its keep.
        </h1>
        <div className="shop-hero-meta">
          <HowBuyingWorksLink />
        </div>
      </ShopHero>

      <GardenWall>
        <BuyingStrip kind="gear" />

        {error ? (
          <div className="shop-shell shop-main">
            <div className="card shop-empty">
              <div className="shop-empty-title">
                The equipment list didn&rsquo;t load.
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
          <ItemsClient
            kind="gear"
            items={gear}
            bundlePool={all}
            redditPostUrl={redditPostUrl}
          />
        )}

        <BuyingTerms kind="gear" trackRecord={trackRecord}>
          Turntables, amps and the odd accessory I&rsquo;ve upgraded past. Each
          one was running in my system before it was listed; what works,
          what&rsquo;s included and any quirks are written up on its page. I
          write about this gear at{" "}
          <Link href="https://lateonsetaudiophile.com">
            Late Onset Audiophile
          </Link>
          .
        </BuyingTerms>
      </GardenWall>
    </>
  );
}
