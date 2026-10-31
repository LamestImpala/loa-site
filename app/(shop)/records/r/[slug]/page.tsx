import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { SELLER_INFO } from "@/lib/records";
import {
  cleanDiscogsName,
  gradeInfo,
  groupBySide,
  idFromSlug,
  isOnHold,
  recordPath,
  relatedGroups,
  splitPressing,
  trackRecordLine,
} from "@/lib/record-info";
import type { DbRecord } from "@/lib/supabase";
import { PAGE_COLUMNS, getListedRecords, getRedditPostUrl, getShopStats } from "../../data";
import { DiscogsLink, RecordBuyBox, RecordGallery } from "./record-client";

export const revalidate = 60;

const SITE = "https://curiouserrecords.com";

async function loadRecord(slug: string) {
  const id = idFromSlug(slug);
  if (id == null) return { record: null, records: [] as DbRecord[] };
  const { records } = await getListedRecords(PAGE_COLUMNS);
  return { record: records.find((r) => r.id === id) ?? null, records };
}

function coverOf(r: DbRecord) {
  return r.photo_urls?.[0] || r.cover_image || "";
}

function describe(r: DbRecord) {
  const grade = `Media ${r.media}, sleeve ${r.sleeve}`;
  const note = r.notes ? ` ${r.notes.replace(/\s+/g, " ").trim()}` : "";
  return `${cleanDiscogsName(r.pressing)}. ${grade}.${note}${r.sold ? " Sold" : ` $${r.price}`} from a one-person shop in Phoenix, AZ.`.slice(0, 300);
}

export async function generateMetadata({
  params,
}: PageProps<"/records/r/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { record: r } = await loadRecord(slug);
  if (!r) return { title: "Record not found — Curiouser Records" };
  const name = `${cleanDiscogsName(r.artist)} — ${r.title}`;
  const title = `${name} (${r.media}/${r.sleeve}) — Curiouser Records`;
  const cover = coverOf(r);
  const path = recordPath(r);
  return {
    title,
    description: describe(r),
    alternates: { canonical: path },
    openGraph: {
      title: `${name} · ${r.sold ? "Sold" : `$${r.price}`}`,
      description: describe(r),
      url: path,
      siteName: "Curiouser Records",
      type: "website",
      images: cover ? [{ url: cover, alt: name }] : undefined,
    },
    twitter: {
      card: cover ? "summary_large_image" : "summary",
      title: `${name} · ${r.sold ? "Sold" : `$${r.price}`}`,
      description: describe(r),
      images: cover ? [cover] : undefined,
    },
  };
}

function jsonLd(r: DbRecord) {
  const url = `${SITE}${recordPath(r)}`;
  const images = (r.photo_urls?.length ? r.photo_urls : [r.cover_image]).filter(Boolean);
  const name = `${cleanDiscogsName(r.artist)} — ${r.title}`;
  const availability = isOnHold(r)
    ? "https://schema.org/LimitedAvailability"
    : "https://schema.org/InStock";
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${url}#product`,
        name: `${name} (vinyl)`,
        url,
        image: images,
        description: describe(r),
        sku: `CR-${r.id}`,
        ...(r.barcode ? { gtin: r.barcode } : {}),
        category: "Media > Music & Sound Recordings > Vinyl",
        subjectOf: { "@id": `${url}#album` },
        // Sold records carry no offer, so search results don't show a price.
        ...(r.sold
          ? {}
          : {
              offers: {
                "@type": "Offer",
                url,
                price: r.price.toFixed(2),
                priceCurrency: "USD",
                availability,
                // Mint means sealed here; everything else has been played.
                itemCondition:
                  r.media === "M"
                    ? "https://schema.org/NewCondition"
                    : "https://schema.org/UsedCondition",
                seller: { "@type": "Organization", name: "Curiouser Records", url: SITE },
                shippingDetails: {
                  "@type": "OfferShippingDetails",
                  shippingRate: { "@type": "MonetaryAmount", value: "6.00", currency: "USD" },
                  shippingDestination: { "@type": "DefinedRegion", addressCountry: "US" },
                },
              },
            }),
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
              track: r.tracklist.map((t) => ({
                "@type": "MusicRecording",
                name: t.title,
              })),
            }
          : {}),
      },
    ],
  };
  // Escape "<" so a title like "</script>" can't end the tag early.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export default async function RecordPage({ params }: PageProps<"/records/r/[slug]">) {
  const { slug } = await params;
  const [{ record: r, records }, redditPostUrl, stats] = await Promise.all([
    loadRecord(slug),
    getRedditPostUrl(),
    getShopStats(),
  ]);
  if (!r) notFound();
  // One URL per record: a stale or hand-typed slug forwards to the real one.
  const canonical = recordPath(r);
  if (`/r/${slug}` !== canonical) permanentRedirect(canonical);

  const spec = splitPressing(r.pressing);
  const media = gradeInfo(r.media);
  const sleeve = gradeInfo(r.sleeve);
  const sides = groupBySide(r.tracklist ?? []);
  const styles = (r.styles ?? []).filter((s) => !(r.genres ?? []).includes(s));
  const related = relatedGroups(r, records);
  const bundleCandidates = records.filter((x) => !x.sold);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(r) }}
      />
      <div className="shop-shell rp">
        <nav className="rp-crumbs" aria-label="Breadcrumb">
          <Link href="/">← All records</Link>
          {r.genres?.[0] ? (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/?genre=${encodeURIComponent(r.genres[0])}`}>{r.genres[0]}</Link>
            </>
          ) : null}
        </nav>

        <div className="rp-top">
          <RecordGallery record={r} />

          <div className="rp-info">
            <header className="rp-head">
              <p className="rp-artist">
                <Link href={`/?q=${encodeURIComponent(r.artist)}`}>
                  {cleanDiscogsName(r.artist)}
                </Link>
              </p>
              <h1 className="rp-title">{r.title}</h1>
              <p className="rp-sub">
                {[spec.year, spec.label, r.collection].filter(Boolean).join(" · ")}
              </p>
            </header>

            <RecordBuyBox
              record={r}
              bundleCandidates={bundleCandidates}
              redditPostUrl={redditPostUrl}
            />

            <section className="rp-section" aria-labelledby="rp-condition">
              <h2 id="rp-condition">Condition</h2>
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
              {r.notes ? (
                <blockquote className="rp-note">
                  <p>{r.notes}</p>
                  <footer>— my notes on this copy</footer>
                </blockquote>
              ) : null}
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
            </section>

            <section className="rp-section" aria-labelledby="rp-pressing">
              <h2 id="rp-pressing">Pressing</h2>
              <dl className="rp-specs">
                {spec.year ? (
                  <div>
                    <dt>Released</dt>
                    <dd>{spec.year}</dd>
                  </div>
                ) : null}
                {spec.label ? (
                  <div>
                    <dt>Label · Cat #</dt>
                    <dd>{spec.label}</dd>
                  </div>
                ) : null}
                {spec.formats ? (
                  <div>
                    <dt>Format</dt>
                    <dd>{spec.formats}</dd>
                  </div>
                ) : null}
                {r.country ? (
                  <div>
                    <dt>Country</dt>
                    <dd>{r.country}</dd>
                  </div>
                ) : null}
                {r.barcode ? (
                  <div>
                    <dt>Barcode</dt>
                    <dd>{r.barcode}</dd>
                  </div>
                ) : null}
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
                      <Link href={`/?coll=${encodeURIComponent(r.collection)}`}>
                        {r.collection}
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="rp-fine">
                <DiscogsLink record={r} />
              </p>
            </section>

            {sides.length ? (
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
                            {t.duration ? (
                              <span className="rp-dur">{t.duration}</span>
                            ) : null}
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
                <li>{SELLER_INFO.shipping}</li>
                <li>{SELLER_INFO.payment}</li>
                <li>{SELLER_INFO.guarantee}</li>
                {trackRecordLine(stats) ? (
                  <li>{trackRecordLine(stats)}, all from my own shelves.</li>
                ) : null}
              </ul>
            </section>
          </div>
        </div>

        {related.length ? <h2 className="rp-related-heading">More from the shelves</h2> : null}
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
                    <Link href={recordPath(x)} className="rp-related-card">
                      <span className="rp-related-cover">
                        {cover ? (
                          <Image src={cover} alt="" width={240} height={240} sizes="(min-width: 900px) 180px, 45vw" />
                        ) : null}
                      </span>
                      <span className="rp-related-title">
                        {cleanDiscogsName(x.artist)} — {x.title}
                      </span>
                      <span className="rp-related-meta">
                        <span>${x.price}</span>
                        <span>
                          {x.media}/{x.sleeve}
                        </span>
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
