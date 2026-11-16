import type { Metadata } from "next";
import { GardenWall, ShopHero } from "../shop-hero";
import { BuyingTerms, HowBuyingWorksLink } from "../buying-terms";
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
  title: "Pearl Jam Concert Posters — Curiouser Records",
  description:
    "Pearl Jam concert posters from my own wall — show posters by the artists who made them, stored flat, shipped rolled in a tube.",
  alternates: { canonical: "/posters" },
};

export const revalidate = 60;

export default async function PostersPage() {
  const [{ items: posters, error }, { items: all }, redditPostUrl, stats] =
    await Promise.all([
      getListedByKind("poster"),
      getListedItems(),
      getRedditPostUrl(),
      getShopStats(),
    ]);
  const trackRecord = trackRecordLine(stats);

  return (
    <>
      <ShopHero>
        <p className="shop-hero-kicker">
          Phoenix, Arizona · from the wall, not a warehouse
        </p>
        <h1>
          <em>Pearl Jam</em> show posters.
        </h1>
        <div className="shop-hero-meta">
          <HowBuyingWorksLink />
        </div>
      </ShopHero>

      <GardenWall>
        {error ? (
          <div className="shop-shell shop-main">
            <div className="card shop-empty">
              <div className="shop-empty-title">
                The poster list didn&rsquo;t load.
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
            kind="poster"
            items={posters}
            bundlePool={all}
            redditPostUrl={redditPostUrl}
          />
        )}

        <BuyingTerms kind="poster" trackRecord={trackRecord}>
          Concert posters I bought at the shows or from the artists who drew
          them, kept flat and out of the sun. Venue, date, edition and size are
          listed on every one; the photos are of the actual print.
        </BuyingTerms>
      </GardenWall>
    </>
  );
}
