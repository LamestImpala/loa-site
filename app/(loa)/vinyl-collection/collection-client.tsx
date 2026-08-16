"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { DiscogsRelease } from "@/lib/discogs";

const ALBUMS_PER_PAGE = 12;

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

function Pagination({
  currentPage,
  totalPages,
  onSelect,
}: {
  currentPage: number;
  totalPages: number;
  onSelect: (page: number) => void;
}) {
  const paginationItems = buildPagination(currentPage, totalPages);

  if (totalPages <= 1) return null;

  const buttonClass = (active: boolean) =>
    `rounded-lg border px-4 py-2 text-sm transition ${
      active
        ? "border-white bg-white text-black"
        : "border-white/15 text-neutral-200 hover:bg-white hover:text-black"
    }`;

  return (
    <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
      {currentPage > 1 ? (
        <button
          type="button"
          onClick={() => onSelect(currentPage - 1)}
          className={buttonClass(false)}
        >
          Previous
        </button>
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

        return (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            className={buttonClass(item === currentPage)}
          >
            {item}
          </button>
        );
      })}

      {currentPage < totalPages ? (
        <button
          type="button"
          onClick={() => onSelect(currentPage + 1)}
          className={buttonClass(false)}
        >
          Next
        </button>
      ) : null}
    </div>
  );
}

export default function CollectionClient({
  releases,
}: {
  releases: DiscogsRelease[];
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return releases;
    return releases.filter((item) => {
      const info = item.basic_information;
      const title = info.title?.toLowerCase() || "";
      const artist =
        info.artists?.map((a) => a.name).join(", ").toLowerCase() || "";
      return title.includes(q) || artist.includes(q);
    });
  }, [releases, query]);

  const totalAlbums = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalAlbums / ALBUMS_PER_PAGE));
  const safeCurrentPage = Math.min(page, totalPages);
  const startIndex = (safeCurrentPage - 1) * ALBUMS_PER_PAGE;
  const endIndex = startIndex + ALBUMS_PER_PAGE;
  const visibleReleases = filtered.slice(startIndex, endIndex);

  function selectPage(next: number) {
    setPage(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <>
      <div className="mt-8 max-w-xl">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search by artist or album title"
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-base text-white placeholder:text-neutral-500 focus:border-white/30 focus:outline-none"
        />
      </div>

      <div className="mt-4 text-sm text-neutral-400">
        Showing {totalAlbums === 0 ? 0 : startIndex + 1}-
        {Math.min(endIndex, totalAlbums)} of {totalAlbums} albums
        {query.trim() ? <> for “{query.trim()}”</> : null}
      </div>

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
              <a
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
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
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
              </a>
            );
          })}
        </div>
      )}

      <Pagination
        currentPage={safeCurrentPage}
        totalPages={totalPages}
        onSelect={selectPage}
      />
    </>
  );
}
