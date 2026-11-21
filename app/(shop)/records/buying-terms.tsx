import { FREE_SHIPPING_MIN, SELLER_INFO } from "@/lib/records";
import type { ItemKind } from "@/lib/supabase";

// The same shipping terms, cut down to a few words for the strip.
const SHIPPING_SHORT: Record<ItemKind, string> = {
  record: `$6 shipping, free on ${FREE_SHIPPING_MIN} or more`,
  poster: "$12 flat shipping for any number",
  gear: "Shipping quoted per order, or free pickup",
};

// "How buying works" in four facts, at the top of the sheet: a buyer who
// only browses never scrolls down to the full terms under the listings, so
// the essentials sit above the search box and link down to the rest. (If
// FAQ answers come — international shipping, returns, holds — they would
// start here.)
export function BuyingStrip({ kind }: { kind: ItemKind }) {
  return (
    <aside className="shop-shell shop-buying-strip" aria-label="How buying works">
      <div className="shop-buying-strip-line">
        <ul>
          <li>Request by email or Reddit DM, no account</li>
          <li>PayPal invoice, I cover the fee</li>
          <li>{SHIPPING_SHORT[kind]}</li>
          <li>Not as described? I&rsquo;ll make it right</li>
        </ul>
        <a href="#how-buying-works">Full terms ↓</a>
      </div>
    </aside>
  );
}

// How each kind ships, in the seller's words.
const SHIPPING: Record<ItemKind, string> = {
  record: SELLER_INFO.shipping,
  poster: `${SELLER_INFO.posterShipping} Bundle records too and each ships its own way.`,
  gear: SELLER_INFO.gearShipping,
};

// The link in the hero band that jumps to the terms below the listings.
export function HowBuyingWorksLink() {
  return (
    <a className="shop-hero-how" href="#how-buying-works">
      How buying works ↓
    </a>
  );
}

// "How buying works": the page's introduction and the buying terms, as a
// ruled list like a colophon. It used to fill the hero; it now sits under
// the listings, reached from the hero's link, so the listings themselves
// start on the first screen.
export function BuyingTerms({
  kind,
  trackRecord,
  children,
}: {
  kind: ItemKind;
  trackRecord: string | null;
  // The page's own introduction.
  children?: React.ReactNode;
}) {
  return (
    <section
      className="shop-shell shop-terms"
      id="how-buying-works"
      aria-labelledby="how-buying-works-title"
    >
      <h2 id="how-buying-works-title">How buying works</h2>
      {children ? <p className="shop-terms-lede">{children}</p> : null}
      <div className="shop-terms-list">
        <div>
          <strong>Contact:</strong> {SELLER_INFO.contact}
        </div>
        <div>
          <strong>Payment:</strong> {SELLER_INFO.payment}
        </div>
        <div>
          <strong>Shipping:</strong> {SHIPPING[kind]}
        </div>
        <div>
          <strong>Not as described?</strong> Email me and I&rsquo;ll make it
          right.
        </div>
        {trackRecord ? (
          <div>
            <strong>Track record:</strong> {trackRecord},{" "}
            {kind === "record"
              ? "every one graded and packed by me."
              : "every one packed by me."}
          </div>
        ) : null}
      </div>
    </section>
  );
}
