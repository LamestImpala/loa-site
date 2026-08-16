import type { Viewport } from "next";
import { Geist } from "next/font/google";
import VercelAnalytics from "./analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets env(safe-area-inset-*) resolve on notched phones (shop bundle bar).
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body className="bg-neutral-950 text-neutral-100 font-sans antialiased">
        {children}
        <VercelAnalytics />
      </body>
    </html>
  );
}
