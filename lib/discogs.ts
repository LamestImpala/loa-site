export type DiscogsRelease = {
  id: number;
  instance_id?: number;
  date_added?: string;
  basic_information: {
    id: number;
    title: string;
    year?: number;
    cover_image?: string;
    resource_url?: string;
    artists?: { name: string }[];
  };
};

type DiscogsCollectionResponse = {
  pagination?: {
    page: number;
    pages: number;
    per_page: number;
    items: number;
  };
  releases?: DiscogsRelease[];
};

export async function getDiscogsCollection(): Promise<DiscogsRelease[]> {
  const username = process.env.DISCOGS_USERNAME;
  const token = process.env.DISCOGS_TOKEN;

  if (!username || !token) {
    throw new Error("Missing Discogs environment variables.");
  }

  const perPage = 100;
  let page = 1;
  let totalPages = 1;
  const allReleases: DiscogsRelease[] = [];

  do {
    const url = `https://api.discogs.com/users/${username}/collection/folders/0/releases?per_page=${perPage}&page=${page}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Discogs token=${token}`,
        "User-Agent": "LateOnsetAudiophile/1.0",
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      throw new Error(`Discogs API request failed with status ${response.status}`);
    }

    const data: DiscogsCollectionResponse = await response.json();

    allReleases.push(...(data.releases ?? []));
    totalPages = data.pagination?.pages ?? 1;
    page += 1;
  } while (page <= totalPages);

  return allReleases.sort((a, b) => {
    const aTime = a.date_added ? new Date(a.date_added).getTime() : 0;
    const bTime = b.date_added ? new Date(b.date_added).getTime() : 0;
    return bTime - aTime;
  });
}