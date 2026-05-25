import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Podcast — Late Onset Audiophile",
  description:
    "The LOA podcast is coming soon — honest conversations about the audio journey, the gear, the music, and the moments that made it all worth it.",
};

export default function PodcastPage() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20 text-white">
      <h1 className="text-4xl font-semibold">Podcast</h1>
      <p className="mt-4 text-neutral-300">
        Coming soon.
      </p>
    </section>
  );
}