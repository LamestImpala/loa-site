// The Stock fields a Discogs /releases/:id response fills in — shared by
// the Add item drawer and the hourly collection import, so both write a
// record the same way.
import { releaseDetailsFromDiscogs, type ReleaseDetails } from "@/lib/record-info";
import { detectCollection, type DiscogsReleaseLike } from "./collection";

export type DiscogsReleaseJson = DiscogsReleaseLike &
  Parameters<typeof releaseDetailsFromDiscogs>[0] & {
    title?: string;
    year?: number;
    thumb?: string;
    artists?: { name: string }[];
    labels?: { name?: string; catno?: string }[];
    genres?: string[];
    images?: { type: string; uri?: string }[];
  };

export type ReleaseRow = {
  artist: string;
  title: string;
  pressing: string; // "year · label catno · format descriptions"
  cover_image: string;
  genres: string[];
  collection: string; // "" when the release is in no known series
  details: ReleaseDetails; // tracklist, country, barcode, styles for the record page
};

export function recordRowFromRelease(rel: DiscogsReleaseJson): ReleaseRow {
  const label = rel.labels?.[0];
  const descriptions = (rel.formats ?? []).flatMap((f) => f.descriptions ?? []).join(", ");
  const pressing = [
    rel.year ? String(rel.year) : null,
    [label?.name, label?.catno].filter(Boolean).join(" ") || null,
    descriptions || null,
  ]
    .filter(Boolean)
    .join(" · ");
  const primary = rel.images?.find((im) => im.type === "primary") ?? rel.images?.[0];
  return {
    artist: rel.artists?.map((a) => a.name).join(", ") ?? "",
    title: rel.title ?? "",
    pressing,
    cover_image: primary?.uri ?? rel.thumb ?? "",
    genres: rel.genres ?? [],
    collection: detectCollection(rel),
    details: releaseDetailsFromDiscogs(rel),
  };
}
