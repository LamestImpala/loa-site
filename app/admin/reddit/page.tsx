import type { Metadata } from "next";
import { RedditPage } from "../_reddit/reddit-page";

export const metadata: Metadata = {
  title: "Reddit tools — Late Onset Audiophile",
  robots: { index: false, follow: false },
};

export default function AdminRedditPage() {
  return <RedditPage />;
}
