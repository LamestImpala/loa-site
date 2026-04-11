import Image from "next/image";
import { getDiscogsCollection } from "@/lib/discogs";

export default async function VinylCollectionPage() {
  const releases = await getDiscogsCollection();

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
        <h1 className="text-3xl font-semibold md:text-5xl">Vinyl Collection</h1>

        <p className="mt-4 max-w-3xl text-base text-neutral-300 md:text-lg">
          A live look at my Discogs collection, from longtime favorites to newer discoveries.
        </p>

        <a
          href="https://www.discogs.com/user/LateOnsetAudiophile/collection?header=1"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-block rounded-full border border-white/15 px-5 py-2 text-sm text-white transition hover:bg-white hover:text-black"
        >
          View Full Collection on Discogs
        </a>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {releases.map((item) => {
            const info = item.basic_information;
            const artist =
              info.artists?.map((a) => a.name).join(", ") || "Unknown Artist";

            return (
              <article
                key={item.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4"
              >
                {info.cover_image ? (
                  <Image
                    src={info.cover_image}
                    alt={`${artist} - ${info.title}`}
                    width={600}
                    height={600}
                    className="h-auto w-full rounded-xl object-cover"
                  />
                ) : null}

                <div className="mt-4">
                  <h2 className="text-lg font-medium">{info.title}</h2>
                  <p className="mt-1 text-sm text-neutral-300">{artist}</p>
                  <p className="mt-1 text-sm text-neutral-400">
                    {info.year || "Unknown year"}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}