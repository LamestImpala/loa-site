import type { Metadata } from "next";
import { getDiscogsCollection } from "@/lib/discogs";
import CollectionClient from "./collection-client";

export const metadata: Metadata = {
  title: "Vinyl Collection — Late Onset Audiophile",
  description:
    "A live look at my Discogs vinyl collection, sorted by most recently added. ~500 records and counting.",
};

export default async function VinylCollectionPage() {
  const releases = await getDiscogsCollection();

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

      <CollectionClient releases={releases} />
    </section>
  );
}
