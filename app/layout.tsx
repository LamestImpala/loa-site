import type { Metadata } from "next";
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
        url: "/og-image.jpg",
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
    images: ["/og-image.jpg"],
  },
};