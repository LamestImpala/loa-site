export default function VinylCollectionLoading() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
        <div className="h-10 w-64 animate-pulse rounded-xl bg-white/10" />
        <div className="mt-4 h-5 w-96 animate-pulse rounded-lg bg-white/10" />
        <div className="mt-8 h-12 w-80 animate-pulse rounded-xl bg-white/10" />

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <div className="aspect-square w-full animate-pulse rounded-xl bg-white/10" />
              <div className="mt-4 h-5 w-3/4 animate-pulse rounded-lg bg-white/10" />
              <div className="mt-2 h-4 w-1/2 animate-pulse rounded-lg bg-white/10" />
              <div className="mt-1 h-4 w-1/4 animate-pulse rounded-lg bg-white/10" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
