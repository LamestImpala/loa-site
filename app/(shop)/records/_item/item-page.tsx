import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { POSTER_TUBE_RATE, SELLER_INFO } from "@/lib/records";
import {
  cleanDiscogsName,
  gradeInfo,
  groupBySide,
  idFromSlug,
  isOnHold,
  relatedGroups,
  splitPressing,
  trackRecordLine,
} from "@/lib/record-info";
import {
  KIND_PLURALS,
  KIND_PREFIX,
  itemPath,
  itemSpecShort,
  itemSubtitle,
  kindOf,
  posterYear,
} from "@/lib/items";
import type { DbRecord, ItemKind } from "@/lib/supabase";
import { PAGE_COLUMNS, getListedItems, getRedditPostUrl, getShopStats } from "../data";
import { DiscogsLink, RecordBuyBox, RecordGallery } from "./item-client";

/*
 * One detail page for every kind of item. The route files under r/, p/
 * (and e/) are thin: they name the kind and hand the slug here. The page
 * shows the sections that kind has — a record's pressing and tracklist, a
 * poster's show and edition — and redirects a wrong-prefix or stale-slug
 * link to the item's canonical path.
 */

const SITE = "https://curiouserrecords.com";

// Where each kind's list lives and what to call it in links.
const LIST_PATH: Record<ItemKind, string> = { record: "/", poster: "/posters", gear: "/equipment" };

export async function loadItem(slug: string) {
  const id = idFromSlug(slug);
  if (id == null) return { item: null, items: [] as DbRecord[] };
  const { items } = await getListedItems(PAGE_COLUMNS);
  return { item: items.find((r) => r.id === id) ?? null, items };
}

function coverOf(r: DbRecord) {
  return r.photo_urls?.[0] || (kindOf(r) === "record" ? r.cover_image : "") || "";
}

function showDate(r: DbRecord) {
  const raw = r.details?.show_date;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw ?? "";
  return new Date(`${raw}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function describe(r: DbRecord) {
  const note = r.notes ? ` ${r.notes.replace(/\s+/g, " ").trim()}` : "";
  const price = r.sold ? " Sold" : ` $${r.price}`;
  const tail = `${price} from a one-person shop in Phoenix, AZ.`;
  switch (kindOf(r)) {
    case "record":
      return `${cleanDiscogsName(r.pressing)}. Media ${r.media}, sleeve ${r.sleeve}.${note}${tail}`.slice(0, 300);
    case "poster": {
      const d = r.details ?? {};
      const bits = [itemSubtitle(r), d.designer ? `by ${d.designer}` : "", d.edition, d.dimensions]
        .filter(Boolean)
        .join(" · ");
      return `Concert poster${bits ? `: ${bits}` : ""}. Condition: ${r.condition ?? "see photos"}.${note}${tail}`.slice(0, 300);
    }
    case "gear": {
      const d = r.details ?? {};
      return `${[d.category, d.working_note].filter(Boolean).join(". ")}. Condition: ${r.condition ?? "see notes"}.${note}${tail}`.slice(0, 300);
    }
  }
}

function displayName(r: DbRecord) {
  return `${cleanDiscogsName(r.artist)} — ${r.title}`;
}

function pageTitle(r: DbRecord) {
  const name = displayName(r);
  switch (kindOf(r)) {
    case "record":
      return `${name} (${r.media}/${r.sleeve}) — Curiouser Records`;
    case "poster":
      return `${name} concert poster — Curiouser Records`;
    case "gear":
      return `${name}${r.condition ? ` (${r.condition})` : ""} — Curiouser Records`;
  }
}

export async function itemMetadata(kind: ItemKind, slug: string): Promise<Metadata> {
  const { item: r } = await loadItem(slug);
  if (!r) return { title: `${kind === "gear" ? "Item" : kind === "poster" ? "Poster" : "Record"} not found — Curiouser Records` };
  const name = displayName(r);
  const cover = coverOf(r);
  const path = itemPath(r);
  const og = `${name} · ${r.sold ? "Sold" : `$${r.price}`}`;
  return {
    title: pageTitle(r),
    description: describe(r),
    alternates: { canonical: path },
    openGraph: {
      title: og,
      description: describe(r),
      url: path,
      siteName: "Curiouser Records",
      type: "website",
      images: cover ? [{ url: cover, alt: name }] : undefined,
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title: og,
      description: describe(r),
      images: cover ? [cover] : undefined,
    },
  };
}

function offer(r: DbRecord, url: string) {
  const kind = kindOf(r);
  const availability = isOnHold(r)
    ? "https://schema.org/LimitedAvailability"
    : "https://schema.org/InStock";
  // Mint means sealed/unhung here; everything else has been used.
  const mint = kind === "record" ? r.media === "M" : r.condition === "Mint";
  return {
    "@type": "Offer",
    url,
    price: r.price.toFixed(2),
    priceCurrency: "USD",
    availability,
    itemCondition: mint ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
    seller: { "@type": "Organization", name: "Curiouser Records", url: SITE },
    // Gear is quoted per order, so it carries no shipping rate.
    ...(kind === "gear"
      ? {}
      : {
          shippingDetails: {
            "@type": "OfferShippingDetails",
            shippingRate: {
              "@type": "MonetaryAmount",
              value: kind === "poster" ? POSTER_TUBE_RATE.toFixed(2) : "6.00",
              currency: "USD",
            },
            shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
          },
        }),
  };
}

function jsonLd(r: DbRecord) {
  const kind = kindOf(r);
  const url = `${SITE}${itemPath(r)}`;
  const images = (r.photo_urls?.length ? r.photo_urls : [coverOf(r)]).filter(Boolean);
  const name = displayName(r);
  const product = {
    "@type": "Product",
    "@id": `${url}#product`,
    url,
    image: images,
    description: describe(r),
    sku: `CR-${r.id}`,
    // Sold items carry no offer, so search results don't show a price.
    ...(r.sold ? {} : { offers: offer(r, url) }),
  };
  const graph =
    kind === "record"
      ? [
          {
            ...product,
            name: `${name} (vinyl)`,
            ...(r.barcode ? { gtin: r.barcode } : {}),
            category: "Media > Music & Sound Recordings > Vinyl",
            subjectOf: { "@id": `${url}#album` },
          },
          {
            "@type": "MusicAlbum",
            "@id": `${url}#album`,
            name: r.title,
            byArtist: { "@type": "MusicGroup", name: cleanDiscogsName(r.artist) },
            ...(r.genres?.length ? { genre: r.genres } : {}),
            ...(r.tracklist?.length
              ? {
                  numTracks: r.tracklist.length,
                  track: r.tracklist.map((t) => ({ "@type": "MusicRecording", name: t.title })),
                }
              : {}),
          },
        ]
      : kind === "poster"
        ? [
            {
              ...product,
              name: `${name} (concert poster)`,
              category: "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork",
              ...(r.details?.designer ? { creator: { "@type": "Person", name: r.details.designer } } : {}),
            },
          ]
        : [
            {
              ...product,
              name,
              brand: { "@type": "Brand", name: r.artist },
              model: r.title,
              category: "Electronics > Audio",
            },
          ];
  const data = { "@context": "https://schema.org", "@graph": graph };
  // Escape "<" so a title like "</script>" can't end the tag early.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export async function ItemPage({ kind, slug }: { kind: ItemKind; slug: string }) {
  const [{ item: r, items }, redditPostUrl, stats] = await Promise.all([
    loadItem(slug),
    getRedditPostUrl(),
    getShopStats(),
  ]);
  if (!r) notFound();
  // One URL per item: a stale slug, or the wrong kind's prefix, forwards
  // to the real one.
  const canonical = itemPath(r);
  if (`/${KIND_PREFIX[kind]}/${slug}` !== canonical) permanentRedirect(canonical);
  const actualKind = kindOf(r);

  const records = items.filter((x) => kindOf(x) === "record");
  const bundleCandidates = items.filter((x) => !x.sold);
  const listPath = LIST_PATH[actualKind];
  const trackRecord = trackRecordLine(stats);

  // Record-only bits.
  const spec = splitPressing(r.pressing);
  const media = gradeInfo(r.media);
  const sleeve = gradeInfo(r.sleeve);
  const sides = groupBySide(r.tracklist ?? []);
  const styles = (r.styles ?? []).filter((s) => !(r.genres ?? []).includes(s));
  const related =
    actualKind === "record"
      ? relatedGroups(r, records)
      : (() => {
          const others = items.filter(
            (x) => x.id !== r.id && kindOf(x) === actualKind && !x.sold
          );
          if (others.length === 0) return [];
          const same = others.filter((x) => x.artist === r.artist);
          const pool = same.length >= 2 ? same : others;
          return [
            {
              title: `More ${KIND_PLURALS[actualKind]}`,
              href: listPath,
              records: pool.slice(0, 8),
            },
          ];
        })();
  const d = r.details ?? {};
  const year = posterYear(r);
  const shipping =
    actualKind === "poster"
      ? SELLER_INFO.posterShipping
      : actualKind === "gear"
        ? SELLER_INFO.gearShipping
        : SELLER_INFO.shipping;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(r) }} />
      <div className={`shop-shell rp kind-${actualKind}`}>
        <nav className="rp-crumbs" aria-label="Breadcrumb">
          <Link href={listPath}>← All {KIND_PLURALS[actualKind]}</Link>
          {actualKind === "record" && r.genres?.[0] ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/?genre=${encodeURIComponent(r.genres[0])}`}>{r.genres[0]}</Link>
            </>
          ) : null}
          {actualKind === "poster" && year ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/posters?year=${year}`}>{year}</Link>
            </>
          ) : null}
          {actualKind === "gear" && d.category ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/equipment?cat=${encodeURIComponent(d.category)}`}>{d.category}</Link>
            </>
          ) : null}
        </nav>

        <div className="rp-top">
          <RecordGallery record={r} />

          <div className="rp-info">
            <header className="rp-head">
              <p className="rp-artist">
                <Link href={`${listPath}?q=${encodeURIComponent(r.artist)}`}>
                  {cleanDiscogsName(r.artist)}
                </Link>
              </p>
              <h1 className="rp-title">{r.title}</h1>
              <p className="rp-sub">
                {actualKind === "record"
                  ? [spec.year, spec.label, r.collection].filter(Boolean).join(" · ")
                  : itemSubtitle(r)}
              </p>
            </header>

            <RecordBuyBox record={r} bundleCandidates={bundleCandidates} redditPostUrl={redditPostUrl} />

            <section className="rp-section" aria-labelledby="rp-condition">
              <h2 id="rp-condition">Condition</h2>
              {actualKind === "record" ? (
                <dl className="rp-grades">
                  <div>
                    <dt>Media</dt>
                    <dd>
                      <strong>{r.media}</strong>
                      {media ? ` — ${media.name}. ${media.meaning}` : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Sleeve</dt>
                    <dd>
                      <strong>{r.sleeve}</strong>
                      {sleeve ? ` — ${sleeve.name}.` : null}
                    </dd>
                  </div>
                </dl>
              ) : (
                <dl className="rp-grades">
                  <div>
                    <dt>Overall</dt>
                    <dd>
                      <strong>{r.condition ?? "See photos"}</strong>
                      {actualKind === "poster" && d.condition_note ? ` — ${d.condition_note}` : null}
                      {actualKind === "gear" && d.working_note ? ` — ${d.working_note}` : null}
                    </dd>
                  </div>
                </dl>
              )}
              {r.notes ? (
                <blockquote className="rp-note">
                  <p>{r.notes}</p>
                  <footer>— my notes on this {actualKind === "record" ? "copy" : "one"}</footer>
                </blockquote>
              ) : null}
              {actualKind === "record" ? (
                <p className="rp-fine">
                  Play-graded under good light to the{" "}
                  <a
                    href="https://www.discogs.com/selling/resources/how-to-grade-items/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Goldmine standard
                  </a>
                  . If I&rsquo;m unsure between two grades, I use the lower one.
                </p>
              ) : actualKind === "poster" ? (
                <p className="rp-fine">
                  Stored flat and out of the sun. Anything beyond the odd handling mark is
                  called out above and shown in the photos.
                </p>
              ) : (
                <p className="rp-fine">
                  Tested in my own system before listing. Anything that doesn&rsquo;t work as
                  it should is called out above.
                </p>
              )}
            </section>

            {actualKind === "record" ? (
              <section className="rp-section" aria-labelledby="rp-pressing">
                <h2 id="rp-pressing">Pressing</h2>
                <dl className="rp-specs">
                  <Row label="Released" value={spec.year} />
                  <Row label="Label · Cat #" value={spec.label} />
                  <Row label="Format" value={spec.formats} />
                  <Row label="Country" value={r.country} />
                  <Row label="Barcode" value={r.barcode} />
                  {r.genres?.length ? (
                    <div>
                      <dt>Genre</dt>
                      <dd>{[...r.genres, ...styles].join(", ")}</dd>
                    </div>
                  ) : null}
                  {r.collection ? (
                    <div>
                      <dt>Series</dt>
                      <dd>
                        <Link href={`/?coll=${encodeURIComponent(r.collection)}`}>{r.collection}</Link>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <p className="rp-fine">
                  <DiscogsLink record={r} />
                </p>
              </section>
            ) : actualKind === "poster" ? (
              <section className="rp-section" aria-labelledby="rp-details">
                <h2 id="rp-details">The show &amp; the print</h2>
                <dl className="rp-specs">
                  <Row label="Show" value={showDate(r)} />
                  <Row label="Venue" value={d.venue} />
                  <Row label="City" value={d.city} />
                  <Row label="Poster artist" value={d.designer} />
                  <Row label="Edition" value={d.edition} />
                  <Row label="Size" value={d.dimensions} />
                  <Row label="Print" value={d.print_method} />
                </dl>
              </section>
            ) : (
              <section className="rp-section" aria-labelledby="rp-details">
                <h2 id="rp-details">Details</h2>
                <dl className="rp-specs">
                  <Row label="Brand" value={r.artist} />
                  <Row label="Model" value={r.title} />
                  <Row label="Category" value={d.category} />
                  <Row label="Included" value={d.included} />
                </dl>
              </section>
            )}

            {actualKind === "record" && sides.length ? (
              <section className="rp-section" aria-labelledby="rp-tracks">
                <h2 id="rp-tracks">Tracklist</h2>
                <div className="rp-sides">
                  {sides.map(({ side, tracks }) => (
                    <div key={side || "all"} className="rp-side">
                      {side ? <h3>Side {side}</h3> : null}
                      <ol>
                        {tracks.map((t, i) => (
                          <li key={`${t.position}-${i}`}>
                            <span className="rp-pos">{t.position}</span>
                            <span className="rp-track">{t.title}</span>
                            {t.duration ? <span className="rp-dur">{t.duration}</span> : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rp-section" aria-labelledby="rp-shipping">
              <h2 id="rp-shipping">Shipping &amp; buying</h2>
              <ul className="rp-terms">
                <li>{shipping}</li>
                <li>{SELLER_INFO.payment}</li>
                <li>{SELLER_INFO.guarantee}</li>
                {trackRecord ? <li>{trackRecord}, all from my own shelves.</li> : null}
              </ul>
            </section>
          </div>
        </div>

        {related.length ? (
          <h2 className="rp-related-heading">
            {actualKind === "record" ? "More from the shelves" : "Also on the wall"}
          </h2>
        ) : null}
        {related.map((g, i) => (
          <section key={g.title} className="rp-related" aria-labelledby={`rel-${i}`}>
            <div className="rp-related-head">
              <h3 id={`rel-${i}`}>{g.title}</h3>
              <Link href={g.href}>See all →</Link>
            </div>
            <ul className="rp-related-grid">
              {g.records.map((x) => {
                const cover = coverOf(x);
                return (
                  <li key={x.id}>
                    <Link href={itemPath(x)} className="rp-related-card">
                      <span className="rp-related-cover">
                        {cover ? (
                          <Image
                            src={cover}
                            alt=""
                            width={240}
                            height={240}
                            sizes="(min-width: 900px) 180px, 45vw"
                          />
                        ) : null}
                      </span>
                      <span className="rp-related-title">{displayName(x)}</span>
                      <span className="rp-related-meta">
                        <span>${x.price}</span>
                        <span>{itemSpecShort(x)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
