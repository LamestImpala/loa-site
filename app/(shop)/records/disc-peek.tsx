import type { CSSProperties } from "react";
import { discFace, type DiscStyle } from "@/lib/disc-style";

// A coloured pressing shows a sliver of its disc above the cover in the Cards
// and Covers views; on hover it lifts out of the sleeve and turns (shop.css,
// .disc-peek). Plain black never reaches here (discStyle() returns null for
// it) and a picture disc can't be drawn from words, so both show nothing.
// Decoration only: the colour is in words on the record page.
export function DiscPeek({ style }: { style: DiscStyle | undefined }) {
  if (!style || style.mode === "picture" || style.colors.length === 0) return null;
  return (
    <span
      className="disc-peek"
      style={{ "--disc": discFace(style) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="disc-peek-face" />
    </span>
  );
}
