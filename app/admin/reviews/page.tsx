import type { Metadata } from "next";
import { ReviewsSection } from "../_reviews/reviews-section";

export const metadata: Metadata = {
  title: "Reviews — Curiouser Records",
  robots: { index: false, follow: false },
};

export default function AdminReviewsPage() {
  return <ReviewsSection />;
}
