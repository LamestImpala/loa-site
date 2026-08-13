import type { Metadata } from "next";
import { Alice, Rye } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { SELLER_INFO } from "@/lib/records";
import "./shop.css";

const rye = Rye({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-rye",
});

const alice = Alice({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-alice",
});

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
  },
  twitter: {
    card: "summary",
    title: "Curiouser Records",
    description:
      "Curiouser and curiouser vinyl finds — used records graded to the Goldmine standard and shipped in proper LP mailers.",
  },
};

const redditProfile = `https://www.reddit.com/user/${SELLER_INFO.redditUsername}`;

export default function ShopLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={`shop ${rye.variable} ${alice.variable}`}>
      <nav className="shop-nav">
        <Link href="/" aria-label="Curiouser Records home">
          <Image
            src="/images/curiouserlogo.png"
            alt="Curiouser Records"
            width={44}
            height={44}
            className="shop-nav-logo"
          />
        </Link>
        <div className="shop-nav-brand">
          Curiouser <span>Records</span>
        </div>
        <div style={{ flex: 1 }} />
        <a href={redditProfile} target="_blank" rel="noopener noreferrer">
          u/{SELLER_INFO.redditUsername} ↗
        </a>
      </nav>
      <div className="shop-checker" aria-hidden />

      <main>{children}</main>

      <div className="shop-checker" aria-hidden />
      <footer className="shop-footer">
        <div className="shop-footer-inner">
          <div className="shop-footer-about">
            <h2>About the seller</h2>
            <p>
              I&rsquo;m a late-onset audiophile in Phoenix thinning out a
              collection that got away from me. Everything is play-graded under
              good light to the Goldmine standard — if I&rsquo;m unsure between
              two grades, I use the lower one. Prices track Discogs daily, so
              the &ldquo;Drink me&rdquo; drops are genuine.
            </p>
          </div>
          <div className="shop-footer-grades">
            <div className="head">Grade cheat-sheet</div>
            <div>
              <strong>M</strong> — Mint, still sealed or flawless
            </div>
            <div>
              <strong>NM</strong> — Near Mint, looks unplayed
            </div>
            <div>
              <strong>VG+</strong> — light wear, plays clean
            </div>
            <div>
              <strong>VG</strong> — visible wear, minor surface noise
            </div>
          </div>
        </div>
        <div className="shop-footer-bottom">
          curiouserrecords.com · Sold by{" "}
          <a href={redditProfile} target="_blank" rel="noopener noreferrer">
            u/{SELLER_INFO.redditUsername}
          </a>{" "}
          ·{" "}
          <a href="mailto:contact@lateonsetaudiophile.com">
            contact@lateonsetaudiophile.com
          </a>{" "}
          · © {new Date().getFullYear()}
        </div>
      </footer>
    </div>
  );
}
