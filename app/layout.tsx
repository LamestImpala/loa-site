import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://lateonsetaudiophile.com"),
  title: "Late Onset Audiophile",
  description:
    "A modern hi-fi media brand exploring audio journeys, music, gear, and the ah-ha moments that pull us deeper into the hobby.",
  openGraph: {
    title: "Late Onset Audiophile",
    description:
      "Audio journeys, music, gear, and the ah-ha moments that make hi-fi addictive.",
    url: "https://lateonsetaudiophile.com",
    siteName: "Late Onset Audiophile",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Late Onset Audiophile",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Late Onset Audiophile",
    description:
      "Audio journeys, music, gear, and the ah-ha moments that make hi-fi addictive.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-neutral-950 text-neutral-100">
        <nav className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/80 backdrop-blur-md">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-10">
            <Link
  href="/"
  className="flex items-center transition hover:opacity-90"
  aria-label="Late Onset Audiophile home"
>
  <Image
    src="/images/loalogo.png"
    alt="Late Onset Audiophile logo"
    width={1024}
    height={1024}
    className="h-12 w-12 object-contain md:h-[52px] md:w-[52px]"
    priority
  />
</Link>
            <div className="flex items-center gap-6 text-sm text-neutral-300">
              <Link href="/" className="transition hover:text-white">
                Home
              </Link>
              <Link href="/mysystem" className="transition hover:text-white">
                My System
              </Link>
              <Link href="/reviews" className="transition hover:text-white">
                Reviews
              </Link>
              <Link href="/music" className="transition hover:text-white">
                Music
              </Link>
              <Link href="/vinyl-collection" className="hover:text-white">
  Vinyl Collection
</Link>
              <Link href="/podcast" className="transition hover:text-white">
                Podcast
              </Link>
              <Link href="/about" className="transition hover:text-white">
                About
              </Link>
              <Link href="/contact" className="transition hover:text-white">
                Contact
              </Link>
              <a
                href="https://instagram.com/lateonsetaudiophile"
                target="_blank"
                rel="noreferrer"
                className="transition hover:text-white"
              >
                Instagram
              </a>
            </div>
          </div>
        </nav>

        <main className="min-h-screen bg-neutral-950 text-neutral-100">
          {children}
        </main>
      </body>
    </html>
  );
}
