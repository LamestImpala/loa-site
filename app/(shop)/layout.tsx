import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  metadataBase: new URL("https://thebeeskneesrecords.com"),
  title: "The Bee's Knees Records",
  description:
    "Vinyl records for sale, graded to the Goldmine standard and shipped in proper LP mailers.",
  openGraph: {
    title: "The Bee's Knees Records",
    description:
      "Vinyl records for sale, graded to the Goldmine standard and shipped in proper LP mailers.",
    url: "https://thebeeskneesrecords.com",
    siteName: "The Bee's Knees Records",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "The Bee's Knees Records",
    description:
      "Vinyl records for sale, graded to the Goldmine standard and shipped in proper LP mailers.",
  },
};

export default function ShopLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <nav className="sticky top-0 z-50 border-b border-amber-200/20 bg-neutral-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-10">
          <Link
            href="/"
            className="flex items-baseline gap-2 transition hover:opacity-90"
            aria-label="The Bee's Knees Records home"
          >
            <span className="text-lg font-semibold tracking-tight text-amber-300">
              The Bee&apos;s Knees
            </span>
            <span className="text-sm uppercase tracking-[0.25em] text-neutral-400">
              Records
            </span>
          </Link>

          <a
            href="https://lateonsetaudiophile.com"
            className="text-sm text-neutral-400 transition hover:text-white"
          >
            Late Onset Audiophile ↗
          </a>
        </div>
      </nav>

      <main className="min-h-screen bg-neutral-950 text-neutral-100">
        {children}
      </main>

      <footer className="border-t border-amber-200/20 bg-neutral-950">
        <div className="mx-auto max-w-7xl px-6 py-10 md:px-10">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-base font-semibold text-amber-300">
                The Bee&apos;s Knees Records
              </p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-neutral-400">
                Vinyl from a well-kept personal collection. Goldmine-graded,
                packed like it matters.
              </p>
            </div>

            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="mailto:contact@lateonsetaudiophile.com"
                  className="text-neutral-300 transition hover:text-white"
                >
                  contact@lateonsetaudiophile.com
                </a>
              </li>
              <li>
                <a
                  href="https://www.reddit.com/user/LateOnsetAudiophile"
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-300 transition hover:text-white"
                >
                  u/LateOnsetAudiophile on Reddit
                </a>
              </li>
              <li>
                <a
                  href="https://lateonsetaudiophile.com"
                  className="text-neutral-300 transition hover:text-white"
                >
                  A Late Onset Audiophile shop
                </a>
              </li>
            </ul>
          </div>

          <p className="mt-10 border-t border-white/10 pt-6 text-xs text-neutral-500">
            © {new Date().getFullYear()} The Bee&apos;s Knees Records
          </p>
        </div>
      </footer>
    </>
  );
}
