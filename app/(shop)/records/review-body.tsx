"use client";

import { useEffect, useRef, useState } from "react";

const clipped = (el: HTMLElement | null) => !!el && el.scrollHeight > el.clientHeight + 1;

// A review's words and the shop's reply, held to three lines each on the
// home page. "Read more" appears only when something is actually cut off;
// a long review also tucks the reply away until it's opened.
export default function ReviewBody({ body, ownerReply }: { body: string; ownerReply: string | null }) {
  const bodyRef = useRef<HTMLQuoteElement>(null);
  const replyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [bodyClipped, setBodyClipped] = useState(false);
  const [replyClipped, setReplyClipped] = useState(false);

  // Measured only while collapsed: once open nothing is clipped, and the
  // answer from before still says whether "Show less" is worth offering.
  useEffect(() => {
    if (expanded) return;
    const measure = () => {
      setBodyClipped(clipped(bodyRef.current));
      setReplyClipped(clipped(replyRef.current));
    };
    const observer = new ResizeObserver(measure);
    if (bodyRef.current) observer.observe(bodyRef.current);
    if (replyRef.current) observer.observe(replyRef.current);
    return () => observer.disconnect();
  }, [expanded]);

  const clamp = expanded ? undefined : "shop-quote-clamp";
  const showReply = ownerReply && (expanded || !bodyClipped);

  return (
    <>
      <blockquote ref={bodyRef} className={clamp}>
        {body}
      </blockquote>
      {showReply ? (
        <p ref={replyRef} className={clamp ? `shop-quote-reply ${clamp}` : "shop-quote-reply"}>
          <em>Reply:</em> {ownerReply}
        </p>
      ) : null}
      {expanded || bodyClipped || replyClipped ? (
        <button
          type="button"
          className="shop-quote-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </>
  );
}
