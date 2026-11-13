import type { Metadata } from "next";
import { RedditPage } from "../_reddit/reddit-page";

export const metadata: Metadata = {
  title: "Reddit tools — Curiouser Records",
  robots: { index: false, follow: false },
};

export default function AdminRedditPage() {
  return <RedditPage />;
}
