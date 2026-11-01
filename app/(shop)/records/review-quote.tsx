import { reviewAnchor, reviewMonth, SOURCE_LABELS, stars, type ReviewQuote } from "@/lib/review";

// One published review as the shop shows it: stars, the buyer's words, the
// shop's reply, who and when. Shared by the home page's three quotes and
// the full /reviews list, where `anchored` gives each one a linkable id.
export default function ReviewQuoteItem({ quote: q, anchored = false }: { quote: ReviewQuote; anchored?: boolean }) {
  return (
    <li className="shop-quote" id={anchored ? reviewAnchor(q.id) : undefined}>
      {q.rating != null ? (
        <span className="shop-quote-stars" aria-label={`${q.rating} out of 5 stars`}>
          {stars(q.rating)}
        </span>
      ) : null}
      <blockquote>{q.body}</blockquote>
      {q.ownerReply ? (
        <p className="shop-quote-reply">
          <em>Reply:</em> {q.ownerReply}
        </p>
      ) : null}
      <footer>
        <strong>{q.reviewerName}</strong>
        {" · "}
        {reviewMonth(q.reviewedOn)}
        {q.source !== "site" ? ` · via ${SOURCE_LABELS[q.source]}` : ""}
      </footer>
    </li>
  );
}
