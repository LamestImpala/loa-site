"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import {
  FREE_SHIPPING_MIN,
  SELLER_INFO,
  SHIPPING_PER_PARCEL,
} from "@/lib/records";
import { discogsUrl, dropPct, isOnHold, isReduced } from "@/lib/record-info";
import type { DbRecord } from "@/lib/supabase";
import {
  BundleBar,
  BuyDialog,
  PhotoLightbox,
  initials,
  tintFor,
  track,
  useBundle,
  type BuySheet,
  type LightboxState,
} from "../../shop-ui";

// Photos of the actual copy when there are any; otherwise the Discogs stock
// cover, labelled as such so nobody mistakes it for this copy.
export function RecordGallery({ record: r }: { record: DbRecord }) {
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [active, setActive] = useState(0);
  const photos = r.photo_urls ?? [];
  const actual = photos.length > 0;
  const shown = actual ? photos[active] : r.cover_image;
  const tint = tintFor(r.artist);
  const alt = `${r.artist} — ${r.title}${actual ? `, photo ${active + 1} of ${photos.length}` : ", stock cover"}`;

  function open(index: number) {
    track(r.id, "photo_open");
    setLightbox({ record: r, index });
  }

  return (
    <div className="rp-gallery">
      <div
        className="rp-gallery-main"
        style={shown ? undefined : { background: tint.bg }}
      >
        {shown ? (
          actual ? (
            <button
              type="button"
              className="rp-gallery-zoom"
              onClick={() => open(active)}
              aria-label={`Enlarge photo ${active + 1} of ${photos.length}`}
            >
              <Image
                src={shown}
                alt={alt}
                width={900}
                height={900}
                sizes="(min-width: 900px) 480px, 100vw"
                priority
              />
            </button>
          ) : (
            <Image
              src={shown}
              alt={alt}
              width={900}
              height={900}
              sizes="(min-width: 900px) 480px, 100vw"
              priority
            />
          )
        ) : (
          <span className="initials" style={{ color: tint.text }}>
            {initials(r.artist)}
          </span>
        )}
      </div>
      {photos.length > 1 ? (
        <div className="rp-gallery-thumbs">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              className={i === active ? "is-active" : ""}
              aria-label={`Show photo ${i + 1}`}
              aria-pressed={i === active}
              onClick={() => setActive(i)}
            >
              <Image src={url} alt="" width={150} height={150} sizes="80px" />
            </button>
          ))}
        </div>
      ) : null}
      <p className="rp-gallery-caption">
        {actual
          ? `Actual copy pictured — ${photos.length} photo${photos.length === 1 ? "" : "s"}. Tap to enlarge.`
          : "Stock cover from Discogs, not this copy. Want photos of the actual record? Ask in your request."}
      </p>
      <PhotoLightbox state={lightbox} onChange={setLightbox} />
    </div>
  );
}

// Price, the all-in total, and the buy actions. Also hosts the bundle bar
// and the request sheet, shared with the catalog through localStorage.
export function RecordBuyBox({
  record: r,
  bundleCandidates,
  redditPostUrl,
}: {
  record: DbRecord;
  bundleCandidates: DbRecord[];
  redditPostUrl: string;
}) {
  const [sheet, setSheet] = useState<BuySheet | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const bundle = useBundle(bundleCandidates);
  const held = isOnHold(r) && !r.sold;
  const reduced = isReduced(r) && !r.sold;
  const inBundle = bundle.has(r.id);
  // What adding this record does to shipping, given what's already bundled.
  const othersInBundle = bundle.selectedRecords.filter((x) => x.id !== r.id).length;
  const countWithThis = othersInBundle + 1;

  const closeSheet = useCallback(
    (sentBundle: boolean) => {
      if (sentBundle) bundle.clear();
      setSheet(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="rp-buy">
      <div className="rp-price-row">
        {r.sold ? null : reduced ? (
          <>
            <span className="record-prev-price">${r.prev_price}</span>
            <span className="record-price">${r.price}</span>
            <span className="tag tag-accent-2">
              Drink me · ↓ {dropPct(r)}% since yesterday
            </span>
          </>
        ) : (
          <span className="record-price">${r.price}</span>
        )}
      </div>

      {r.sold ? (
        <>
          <button className="btn btn-secondary btn-block" disabled>
            Sold — gone down the rabbit hole
          </button>
          <p className="rp-buy-note">
            This copy has found a new home. The records below are still on
            the shelf.
          </p>
        </>
      ) : held ? (
        <p className="record-hold-note">
          On hold for another buyer. Check back in case it falls through.
        </p>
      ) : (
        <>
          <p className="rp-buy-note">
            {countWithThis >= FREE_SHIPPING_MIN
              ? `Ships free with the ${othersInBundle} other record${othersInBundle === 1 ? "" : "s"} in your bundle.`
              : `+ $${SHIPPING_PER_PARCEL} USPS Media Mail. Bundle ${FREE_SHIPPING_MIN - countWithThis} more and shipping is free.`}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => setSheet({ kind: "single", record: r })}
          >
            Request to buy
          </button>
          <button
            type="button"
            className={`record-select ${inBundle ? "is-selected" : ""}`}
            aria-pressed={inBundle}
            onClick={() => bundle.toggle(r.id)}
          >
            {inBundle ? "✓ In your bundle" : "+ Add to bundle"}
          </button>
          <p className="rp-buy-fine">
            No account needed. {SELLER_INFO.payment}
          </p>
        </>
      )}

      <BundleBar
        records={bundle.selectedRecords}
        onRequest={() => setSheet({ kind: "bundle" })}
        onClear={bundle.clear}
      />
      <BuyDialog
        sheet={sheet}
        bundleRecords={bundle.selectedRecords}
        redditPostUrl={redditPostUrl}
        onClose={closeSheet}
        announce={setLiveMessage}
      />
      <span className="visually-hidden" aria-live="polite">
        {liveMessage}
      </span>
    </div>
  );
}

export function DiscogsLink({ record: r }: { record: DbRecord }) {
  return (
    <a
      href={discogsUrl(r)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track(r.id, "discogs_click")}
    >
      {r.discogs_release_id ? "This pressing on Discogs ↗" : "Search Discogs ↗"}
    </a>
  );
}
