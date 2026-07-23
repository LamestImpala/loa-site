import type { Metadata } from "next";
import { getDiscogsCollection, type DiscogsRelease } from "@/lib/discogs";
import CollectionClient from "./collection-client";

export const metadata: Metadata = {
  title: "Vinyl Collection — Late Onset Audiophile",
  description:
    "A live look at my Discogs vinyl collection, sorted by most recently added. ~500 records and counting.",
};

// Re-render hourly so a failed Discogs fetch heals on the next revalidation
// instead of failing the build (Discogs 500s have broken deploys before).
export const revalidate = 3600;

export default async function VinylCollectionPage() {
  let releases: DiscogsRelease[] | null;
  try {
    releases = await getDiscogsCollection();
  } catch {
    releases = null;
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 text-white md:px-8 md:py-16">
      <h1 className="text-3xl font-semibold md:text-5xl">Vinyl Collection</h1>

      <p className="mt-4 max-w-3xl text-base text-neutral-300 md:text-lg">
        A live look at my Discogs collection, sorted by most recently added.
      </p>

      <a
        href="https://www.discogs.com/user/LateOnsetAudiophile/collection?header=1"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-block rounded-full border border-white/15 px-5 py-2 text-sm text-white transition hover:bg-white hover:text-black"
      >
        View Full Collection on Discogs
      </a>

      {releases ? (
        <CollectionClient releases={releases} />
      ) : (
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8 text-neutral-300">
          The collection is temporarily unavailable — Discogs isn&apos;t
          responding. Check back in a bit, or browse it directly on Discogs
          with the link above.
        </div>
      )}
    </section>
  );
}
