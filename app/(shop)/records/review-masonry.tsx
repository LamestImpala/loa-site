"use client";

import { useEffect, useRef, type ReactNode } from "react";

// The /reviews list as masonry (shop.css .shop-reviews-all.is-masonry): the
// grid's rows are 4px, and each card spans as many of them as it is tall
// plus the gap under it, so cards keep their own height and the next one
// drops into the first column with room. A ResizeObserver re-measures a card
// when its width (the column count) or its font changes. Without script the
// list stays a plain grid of top-aligned cards.
const ROW = 4;

export default function ReviewMasonry({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const items = Array.from(list.children) as HTMLElement[];
    const place = (el: HTMLElement) => {
      const gap = parseFloat(getComputedStyle(el).marginBottom) || 0;
      const span = Math.ceil((el.getBoundingClientRect().height + gap) / ROW);
      el.style.gridRowEnd = `span ${span}`;
    };
    list.classList.add("is-masonry");
    items.forEach(place);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) place(e.target as HTMLElement);
    });
    items.forEach((el) => ro.observe(el));
    return () => {
      ro.disconnect();
      list.classList.remove("is-masonry");
      items.forEach((el) => el.style.removeProperty("grid-row-end"));
    };
  }, [children]);

  return (
    <ul ref={ref} className={className}>
      {children}
    </ul>
  );
}
