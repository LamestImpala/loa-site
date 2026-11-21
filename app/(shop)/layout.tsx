import type { Metadata, Viewport } from "next";
import { Alice, IM_Fell_English, IM_Fell_English_SC } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { GRADES, isReduced } from "@/lib/record-info";
import { kindOf } from "@/lib/items";
import { SELLER_INFO } from "@/lib/records";
import "./celestial-motion.css";
import "./shop.css";
import VisitTracker from "./visit-tracker";
import ShopNavLinks from "./shop-nav-links";
import { ShippingPauseBanner, ShippingPauseProvider } from "./shipping-pause";
import { getListedItems, getShippingPause } from "./records/data";

// IM Fell: 17th-century English types, close kin to the Tenniel-era books
// the Wonderland look borrows from. Roman and italic for display, the
// small-caps cut for labels.
const fell = IM_Fell_English({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-fell",
});

const fellSC = IM_Fell_English_SC({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-fell-sc",
});

const alice = Alice({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-alice",
});

const SHARE_CARD = {
  url: "/images/brand/share-card.jpg",
  width: 1200,
  height: 630,
  alt: "Curiouser Records — the engraved White Rabbit emblem over a celestial engraving: used vinyl from Phoenix, AZ",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://curiouserrecords.com"),
  title: "Curiouser Records — Used Vinyl from Phoenix, AZ",
  description:
    "Curiouser and curiouser vinyl finds — used records graded to the Goldmine standard and shipped in proper LP mailers.",
  openGraph: {
    title: "Curiouser Records",
    description:
      "Curiouser and curiouser vinyl finds — used records graded to the Goldmine standard and shipped in proper LP mailers.",
    url: "https://curiouserrecords.com",
    siteName: "Curiouser Records",
    locale: "en_US",
    type: "website",
    // 1200×630 card built by scripts/share-card.mjs. Record pages replace it
    // with their own cover (itemMetadata in records/_item/item-page.tsx).
    images: [SHARE_CARD],
  },
  twitter: {
    card: "summary_large_image",
    title: "Curiouser Records",
    description:
      "Curiouser and curiouser vinyl finds — used records graded to the Goldmine standard and shipped in proper LP mailers.",
    images: [SHARE_CARD],
  },
};

// The root layout declares a near-black themeColor for the dark LOA site;
// the shop is parchment, so mobile browser chrome should match it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6efdf",
};

export default async function ShopLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [pause, { items }] = await Promise.all([
    getShippingPause(),
    getListedItems(),
  ]);
  // Posters and Equipment leave the nav and the footer while they have
  // nothing for sale, and come back with the first listing.
  const forSale = items.filter((r) => !r.sold);
  const emptyKinds = (["poster", "gear"] as const).filter(
    (kind) => !forSale.some((r) => kindOf(r) === kind)
  );
  // The footer only explains "Drink me" tags while one is showing.
  const hasDrops = forSale.some((r) => isReduced(r));
  return (
    <div
      className={`shop ${fell.variable} ${fellSC.variable} ${alice.variable}`}
    >
      <a className="shop-skip-link" href="#records">
        Skip to the listings
      </a>
      <nav className="shop-nav">
        <Link
          className="shop-nav-home"
          href="/"
          aria-label="Curiouser Records home"
        >
          <Image
            src="/images/brand/logo-192.webp"
            alt=""
            width={192}
            height={192}
            sizes="56px"
            className="shop-nav-logo"
          />
        </Link>
        <div className="shop-nav-brand">
          Curiouser <span>Records</span>
        </div>
        <ShopNavLinks empty={emptyKinds} />
        <div style={{ flex: 1 }} />
        <a
          className="shop-nav-email"
          href={`mailto:${SELLER_INFO.contactEmail}`}
        >
          {SELLER_INFO.contactEmail}
        </a>
      </nav>
      <div className="shop-rule" aria-hidden />
      <ShippingPauseBanner pause={pause} />

      <main>
        <ShippingPauseProvider pause={pause}>{children}</ShippingPauseProvider>
      </main>
      <VisitTracker />

      <div className="shop-rule" aria-hidden />
      <footer className="shop-footer">
        <div className="shop-footer-inner">
          <div className="shop-footer-about">
            <h2>About the seller</h2>
            <p>
              I&rsquo;m a late-onset audiophile in Phoenix thinning out a
              collection that got away from me. Everything is play-graded under
              good light to the Goldmine standard — if I&rsquo;m unsure between
              two grades, I use the lower one. Prices track Discogs daily
              {hasDrops ? (
                <>, so the &ldquo;Drink me&rdquo; drops are genuine.</>
              ) : (
                "."
              )}
            </p>
            <p>{SELLER_INFO.guarantee}</p>
          </div>
          <div className="shop-footer-grades">
            <div className="head">Grade cheat-sheet</div>
            {GRADES.map((g) => (
              <div key={g.code}>
                <strong>{g.code}</strong> — {g.meaning}
              </div>
            ))}
          </div>
        </div>
        <div className="shop-footer-bottom">
          <Link href="/">Records</Link> ·{" "}
          {emptyKinds.includes("poster") ? null : (
            <>
              <Link href="/posters">Posters</Link> ·{" "}
            </>
          )}
          {emptyKinds.includes("gear") ? null : (
            <>
              <Link href="/equipment">Equipment</Link> ·{" "}
            </>
          )}
          <Link href="/reviews">Reviews</Link>
          <br />
          curiouserrecords.com ·{" "}
          <a href={`mailto:${SELLER_INFO.contactEmail}`}>
            {SELLER_INFO.contactEmail}
          </a>{" "}
          · © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
