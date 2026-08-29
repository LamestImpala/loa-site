import type { Metadata } from "next";
import Image from "next/image";
import { SELLER_INFO } from "@/lib/records";
import { createServerSupabase, type DbRecord } from "@/lib/supabase";
import RecordsClient from "./records-client";

export const metadata: Metadata = {
  title: "Records for Sale — Curiouser Records",
  description:
    "Vinyl records for sale from my personal collection. Graded to the Goldmine standard, shipped in proper LP mailers.",
};

export const revalidate = 60;

function SellerInfoLines() {
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
    </>
  );
}

export default async function RecordsPage() {
  const supabase = createServerSupabase();
  const [{ data, error }, { data: settingsData }] = await Promise.all([
    supabase
      .from("records")
      .select(
        "id, artist, title, pressing, media, sleeve, price, prev_price, notes, photos, photo_urls, discogs_release_id, cover_image, genres, collection, sold, listed, hold_until, created_at, updated_at"
      )
      .eq("listed", true)
      .order("artist"),
    supabase.from("settings").select("value").eq("key", "reddit_post_url").single(),
  ]);

  const records = (data ?? []) as DbRecord[];
  const redditPostUrl = settingsData?.value?.trim() ?? "";

  return (
    <>
      <header className="shop-shell shop-hero">
        <div className="shop-hero-copy">
          <div className="tag tag-accent-2" style={{ marginBottom: "var(--space-4)" }}>
            Phoenix, Arizona · one-person shop
          </div>
          <h1>Curiouser and curiouser finds for your turntable.</h1>
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
          {/* Same info twice: an always-open card on desktop, a collapsed
              <details> on phones so records surface within ~1.5 screens. */}
          <div className="card elev-sm shop-hero-info shop-hero-info-static">
            <SellerInfoLines />
          </div>
          <details className="card elev-sm shop-hero-info shop-hero-info-details">
            <summary>How buying works — payment &amp; shipping</summary>
            <div className="shop-hero-info-detail-body">
              <SellerInfoLines />
            </div>
          </details>
          <a className="btn btn-primary shop-hero-cta" href="#records">
            Browse the records ↓
          </a>
        </div>
        <div>
          <Image
            src="/images/curiouserlogo.png"
            alt="Curiouser Records logo"
            width={280}
            height={280}
            priority
            className="shop-hero-logo"
          />
        </div>
      </header>

      {error ? (
        <div className="shop-shell shop-main">
          <div className="card shop-empty">
            <div className="shop-empty-title">
              The record list has gone down the rabbit hole.
            </div>
            <p className="shop-muted" style={{ margin: 0 }}>
              Please check back in a minute.
            </p>
          </div>
        </div>
      ) : (
        <RecordsClient records={records} redditPostUrl={redditPostUrl} />
      )}
    </>
  );
}
