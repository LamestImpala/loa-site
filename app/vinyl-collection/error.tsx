"use client";

export default function VinylCollectionError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
        <h1 className="text-3xl font-semibold md:text-5xl">Vinyl Collection</h1>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8">
          <p className="text-lg font-medium text-neutral-100">
            Could not load the collection right now.
          </p>
          <p className="mt-3 text-base text-neutral-400">
            The Discogs API may be temporarily unavailable. Try again in a
            moment, or{" "}
            <a
              href="https://www.discogs.com/user/LateOnsetAudiophile/collection"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neutral-200 underline decoration-neutral-500 underline-offset-4 hover:text-white"
            >
              view the collection directly on Discogs
            </a>
            .
          </p>

          <button
            onClick={reset}
            className="mt-6 rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm text-white transition hover:bg-white hover:text-black"
          >
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
