import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Late Onset Audiophile — It's never too late to hear what you've been missing",
  description:
    "A modern hi-fi media brand for people who found hi-fi later in life and fell hard for the music, gear, and the ah-ha moments that changed how they listen.",
};

export default function Home() {
  const topics = [
    "Audio journeys",
    "Music that moves us",
    "Amplifiers and AVRs",
    "Speakers and subwoofers",
    "Turntables, tonearms, and cartridges",
    "Streaming and digital audio",
    "Used gear wins and regrets",
    "Collecting records and Discogs tips",
  ];

  const explore = [
    {
      href: "/mysystem",
      title: "My System",
      description:
        "Sonus Faber Olympica Nova V, Marantz PM-10, Clearaudio Concept Signature — the system behind every opinion on this site.",
    },
    {
      href: "/vinyl-collection",
      title: "Vinyl Collection",
      description:
        "A live look at my Discogs collection, sorted by most recently added. ~500 records and counting.",
    },
    {
      href: "/music",
      title: "Music",
      description:
        "How I listen, what I test for, and the listening sessions that tell me whether a system actually works.",
    },
  ];

  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_25%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 md:px-10 md:py-28 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-6">
              <Image
                src="/images/loalogo.webp"
                alt="Late Onset Audiophile logo"
                width={1024}
                height={1024}
                className="h-[72px] w-[72px] object-contain md:h-[96px] md:w-[96px]"
              />
            </div>

            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight md:text-7xl">
              A modern hi-fi story, built from the ground up.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-300 md:text-xl">
              Late Onset Audiophile is a story-driven media brand for people who
              found hi-fi later in life and fell hard for the music, the gear,
              and the ah-ha moments that changed how they listen.
            </p>

            <p className="mt-4 max-w-2xl text-base leading-7 text-neutral-400">
              Right now that means honest gear reviews from a real living room,
              a live look at my vinyl collection, and records from that
              collection for sale.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="https://thebeeskneesrecords.com"
                className="rounded-2xl bg-orange-500 px-6 py-3 font-medium text-white transition hover:scale-[1.02]"
              >
                Browse records for sale
              </Link>

              <Link
                href="/reviews/marantz-pm10-vs-hegel-h390"
                className="rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-medium text-neutral-100 transition hover:bg-white/10"
              >
                Read the review
              </Link>
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl">
              <Image
                src="/images/loa-hero.webp"
                alt="Late Onset Audiophile hero image"
                width={1200}
                height={1400}
                className="h-full w-full object-cover"
                priority
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        <div className="grid gap-8 lg:grid-cols-3">
          <Link
            href="/reviews/marantz-pm10-vs-hegel-h390"
            className="group rounded-[1.75rem] border border-white/10 bg-white/5 p-8 transition hover:border-white/20 hover:bg-white/[0.07] lg:col-span-2"
          >
            <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
              Featured review
            </p>
            <h2 className="mt-4 text-3xl font-semibold md:text-5xl">
              Marantz PM-10 vs Hegel H390
            </h2>
            <p className="mt-6 text-lg leading-8 text-neutral-300">
              I bought both amps used and lived with each in my own system. The
              Hegel was very good, but the Marantz sounded more complete, more
              natural, and easier to listen to for longer sessions — the amp
              that made me stop analyzing and keep playing records.
            </p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white transition group-hover:text-orange-200">
              Read the full review <span aria-hidden="true">→</span>
            </span>
          </Link>

          <div className="rounded-[1.75rem] border border-orange-400/20 bg-orange-500/10 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-orange-200">
              Records for sale
            </p>
            <p className="mt-4 text-lg leading-8 text-neutral-100">
              Vinyl from my personal collection, graded to the Goldmine
              standard and repriced daily against Discogs data. First come,
              first served.
            </p>
            <Link
              href="https://thebeeskneesrecords.com"
              className="mt-6 inline-block rounded-2xl bg-orange-500 px-5 py-3 text-sm font-medium text-white transition hover:scale-[1.02]"
            >
              See what&apos;s available
            </Link>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.03]">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-10">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            Explore
          </p>
          <h2 className="mt-4 text-3xl font-semibold md:text-5xl">
            The system, the shelves, and the listening.
          </h2>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {explore.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-[1.5rem] border border-white/10 bg-neutral-900 p-6 transition hover:border-white/25 hover:bg-neutral-800"
              >
                <h3 className="text-xl font-semibold text-neutral-50">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-neutral-300">
                  {item.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-white transition group-hover:text-orange-200">
                  Visit <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
              What LOA covers
            </p>
            <h2 className="mt-4 text-3xl font-semibold md:text-5xl">
              Music, gear, mistakes, upgrades, and the moments that changed
              everything.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-300">
              The point is not to posture. The point is to share the road into
              better listening, better systems, and better perspective.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {topics.map((topic) => (
              <div
                key={topic}
                className="rounded-2xl border border-white/10 bg-neutral-900 p-5 text-neutral-100"
              >
                {topic}
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
