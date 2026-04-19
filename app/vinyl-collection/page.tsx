import Image from "next/image";
import Link from "next/link";
import { getDiscogsCollection } from "@/lib/discogs";

const ALBUMS_PER_PAGE = 12;

type VinylCollectionPageProps = {
  searchParams: Promise<{
    page?: string;
  }>;
};

function buildPagination(currentPage: number, totalPages: number) {
  if (totalPages <= 6) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages] as const;
  }

  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages] as const;
  }

  return [1, "ellipsis", currentPage, currentPage + 1, currentPage + 2, currentPage + 3, "ellipsis", totalPages] as const;
}

export default async function VinylCollectionPage({
  searchParams,
}: VinylCollectionPageProps) {
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);

  const releases = await getDiscogsCollection();
  const totalAlbums = releases.length;
  const totalPages = Math.max(1, Math.ceil(totalAlbums / ALBUMS_PER_PAGE));

  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ALBUMS_PER_PAGE;
  const endIndex = startIndex + ALBUMS_PER_PAGE;
  const visibleReleases = releases.slice(startIndex, endIndex);
  const paginationItems = buildPagination(safeCurrentPage, totalPages);

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
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

        <div className="mt-4 text-sm text-neutral-400">
          Showing {startIndex + 1}-{Math.min(endIndex, totalAlbums)} of {totalAlbums} albums
        </div>

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visibleReleases.map((item) => {
            const info = item.basic_information;
            const artist =
              info.artists?.map((a) => a.name).join(", ") || "Unknown Artist";

            const discogsUrl = info.resource_url
              ? info.resource_url.replace("api.discogs.com", "www.discogs.com")
              : `https://www.discogs.com/release/${info.id}`;

            return (
              <Link
                key={`${item.id}-${item.instance_id ?? "release"}`}
                href={discogsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-white/25 hover:bg-white/10"
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
              </Link>
            );
          })}
        </div>

        {totalPages > 1 ? (
          <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
            {safeCurrentPage > 1 ? (
              <Link
                href={`/vinyl-collection?page=${safeCurrentPage - 1}`}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
              >
                Previous
              </Link>
            ) : null}

            {safeCurrentPage > 4 ? (
              <Link
                href="/vinyl-collection?page=1"
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
              >
                First
              </Link>
            ) : null}

            {paginationItems.map((item, index) => {
              if (item === "ellipsis") {
                return (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 text-sm text-neutral-500"
                  >
                    …
                  </span>
                );
              }

              const isActive = item === safeCurrentPage;

              return (
                <Link
                  key={item}
                  href={`/vinyl-collection?page=${item}`}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    isActive
                      ? "border-white bg-white text-black"
                      : "border-white/15 text-neutral-200 hover:bg-white hover:text-black"
                  }`}
                >
                  {item}
                </Link>
              );
            })}

            {safeCurrentPage < totalPages - 3 ? (
              <Link
                href={`/vinyl-collection?page=${totalPages}`}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
              >
                Last
              </Link>
            ) : null}

            {safeCurrentPage < totalPages ? (
              <Link
                href={`/vinyl-collection?page=${safeCurrentPage + 1}`}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
              >
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}