import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "./site-nav";

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
        url: "/images/og-image.png",
        width: 945,
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
    images: ["/images/og-image.png"],
  },
};

const FOOTER_LINKS = [
  { href: "https://curiouserrecords.com", label: "Records for Sale" },
  { href: "/reviews", label: "Reviews" },
  { href: "/vinyl-collection", label: "Vinyl Collection" },
  { href: "/mysystem", label: "My System" },
  { href: "/music", label: "Music" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

export default function LoaLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <SiteNav />

      <main className="min-h-dvh bg-neutral-950 text-neutral-100">
        {children}
      </main>

      <footer className="border-t border-white/10 bg-neutral-950">
        <div className="mx-auto max-w-7xl px-6 py-14 md:px-10">
          <div className="grid gap-10 md:grid-cols-3">
            <div>
              <p className="text-lg font-semibold text-white">
                Late Onset Audiophile
              </p>
              <p className="mt-3 max-w-xs text-sm leading-6 text-neutral-400">
                It&apos;s never too late to hear what you&apos;ve been
                missing. Honest hi-fi from a real living room.
              </p>
            </div>

            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">
                Explore
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {FOOTER_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-block py-1 text-neutral-300 transition hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">
                Get in touch
              </p>
              <ul className="mt-4 space-y-1 text-sm">
                <li>
                  <a
                    href="mailto:contact@lateonsetaudiophile.com"
                    className="inline-block py-1 text-neutral-300 transition hover:text-white"
                  >
                    contact@lateonsetaudiophile.com
                  </a>
                </li>
                <li>
                  <a
                    href="https://www.reddit.com/user/LateOnsetAudiophile"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block py-1 text-neutral-300 transition hover:text-white"
                  >
                    u/LateOnsetAudiophile on Reddit
                  </a>
                </li>
                <li>
                  <a
                    href="https://instagram.com/lateonsetaudiophile"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block py-1 text-neutral-300 transition hover:text-white"
                  >
                    Instagram
                  </a>
                </li>
                <li>
                  <a
                    href="https://x.com/lateonsetaudio"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block py-1 text-neutral-300 transition hover:text-white"
                  >
                    X
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <p className="mt-12 border-t border-white/10 pt-6 text-xs text-neutral-500">
            © {new Date().getFullYear()} Late Onset Audiophile
          </p>
        </div>
      </footer>
    </>
  );
}
