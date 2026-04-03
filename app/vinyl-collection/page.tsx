import Link from "next/link";

export default function VinylCollectionPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-5xl px-4 py-12 md:px-8 md:py-16">
        <h1 className="text-3xl font-semibold md:text-5xl">Vinyl Collection</h1>

        <p className="mt-4 max-w-3xl text-base text-neutral-300 md:text-lg">
          A look into the records that have shaped my listening journey, from
          longtime favorites to newer discoveries.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-400">
            Discogs
          </p>

          <p className="mt-3 text-neutral-300">
            Browse the full collection on Discogs.
          </p>

          <Link
            href="https://www.discogs.com/user/LateOnsetAudiophile/collection"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block rounded-full border border-white/15 px-5 py-2 text-sm text-white transition hover:bg-white hover:text-black"
          >
            View My Discogs Collection
          </Link>
        </div>
      </section>
    </main>
  );
}