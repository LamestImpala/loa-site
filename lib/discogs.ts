export type DiscogsRelease = {
  id: number;
  basic_information: {
    title: string;
    year: number;
    artists: { name: string }[];
    cover_image: string;
    formats: { name: string }[];
  };
};

type DiscogsCollectionResponse = {
  releases: DiscogsRelease[];
};

export async function getDiscogsCollection() {
  const username = process.env.DISCOGS_USERNAME;
  const token = process.env.DISCOGS_TOKEN;

  if (!username || !token) {
    throw new Error("Missing Discogs environment variables.");
  }

  const res = await fetch(
    `https://api.discogs.com/users/${username}/collection/folders/0/releases?per_page=24&page=1`,
    {
      headers: {
        Authorization: `Discogs token=${token}`,
        "User-Agent": "LateOnsetAudiophile/1.0",
      },
      next: { revalidate: 3600 },
    }
  );

  if (!res.ok) {
    throw new Error(`Discogs API error: ${res.status}`);
  }

  const data: DiscogsCollectionResponse = await res.json();
  return data.releases;
}