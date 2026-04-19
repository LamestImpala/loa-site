import Image from "next/image";
import Link from "next/link";
import { getDiscogsCollection } from "@/lib/discogs";

const ALBUMS_PER_PAGE = 12;

type VinylCollectionPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
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
    return [
      1,
      "ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ] as const;
  }

  return [
    1,
    "ellipsis",
    currentPage,
    currentPage + 1,
    currentPage + 2,
    currentPage + 3,
    "ellipsis",
    totalPages,
  ] as const;
}

function buildPageHref(page: number, query: string) {
  const params = new URLSearchParams();
  params.set("page", String(page));

  if (query.trim()) {
    params.set("q", query.trim());
  }

  return `/vinyl-collection?${params.toString()}`;
}

function Pagination({
  safeCurrentPage,
  totalPages,
  query,
}: {
  safeCurrentPage: number;
  totalPages: number;
  query: string;
}) {
  const paginationItems = buildPagination(safeCurrentPage, totalPages);

  if (totalPages <= 1) return null;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
      {safeCurrentPage > 1 ? (
        <Link
          href={buildPageHref(safeCurrentPage - 1, query)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
        >
          Previous
        </Link>
      ) : null}

      {safeCurrentPage > 4 ? (
        <Link
          href={buildPageHref(1, query)}
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
            href={buildPageHref(item, query)}
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
          href={buildPageHref(totalPages, query)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
        >
          Last
        </Link>
      ) : null}

      {safeCurrentPage < totalPages ? (
        <Link
          href={buildPageHref(safeCurrentPage + 1, query)}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm text-neutral-200 transition hover:bg-white hover:text-black"
        >
          Next
        </Link>
      ) : null}
    </div>
  );
}

export default async function VinylCollectionPage({
  searchParams,
}: VinylCollectionPageProps) {
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);
  const query = (params.q || "").trim().toLowerCase();

  const releases = await getDiscogsCollection();

  const filteredReleases = releases.filter((item) => {
    const info = item.basic_information;
    const title = info.title?.toLowerCase() || "";
    const artist = info.artists?.map((a) => a.name).join(", ").toLowerCase() || "";

    if (!query) return true;

    return title.includes(query) || artist.includes(query);
  });

  const totalAlbums = filteredReleases.length;
  const totalPages = Math.max(1, Math.ceil(totalAlbums / ALBUMS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * ALBUMS_PER_PAGE;
  const endIndex = startIndex + ALBUMS_PER_PAGE;
  const visibleReleases = filteredReleases.slice(startIndex, endIndex);

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

        <form action="/vinyl-collection" method="get" className="mt-8 max-w-xl">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              name="q"
              defaultValue={params.q || ""}
              placeholder="Search by artist or album title"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm text-white transition hover:bg-white hover:text-black"
            >
              Search
            </button>
            {params.q ? (
              <Link
                href="/vinyl-collection"
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-center text-sm text-white transition hover:bg-white hover:text-black"
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <div className="mt-4 text-sm text-neutral-400">
          {query ? (
            <>
              Showing {totalAlbums === 0 ? 0 : startIndex + 1}-
              {Math.min(endIndex, totalAlbums)} of {totalAlbums} albums for “{params.q}”
            </>
          ) : (
            <>
              Showing {totalAlbums === 0 ? 0 : startIndex + 1}-
              {Math.min(endIndex, totalAlbums)} of {totalAlbums} albums
            </>
          )}
        </div>

        <Pagination
          safeCurrentPage={safeCurrentPage}
          totalPages={totalPages}
          query={params.q || ""}
        />

        {totalAlbums === 0 ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8 text-neutral-300">
            No albums matched your search.
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {visibleReleases.map((item) => {
              const info = item.basic_information;
              const artist =
                info.artists?.map((a) => a.name).join(", ") || "Unknown Artist";

            const discogsUrl =
  typeof info.id === "number"
    ? `https://www.discogs.com/release/${info.id}`
    : "#";
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
        )}

        <Pagination
          safeCurrentPage={safeCurrentPage}
          totalPages={totalPages}
          query={params.q || ""}
        />
      </section>
    </main>
  );
}