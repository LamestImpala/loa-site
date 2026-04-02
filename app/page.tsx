import Image from "next/image";
import Link from "next/link";

export default function Home() {
  const topics = [
    "Audio journeys",
    "Music that moves us",
    "Amplifiers and AVRs",
    "Speakers and subwoofers",
    "Turntables, tonearms, and cartridges",
    "Streaming and digital audio",
    "Used gear wins and regrets",
    "Podcast conversations",
  ];

  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_25%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 md:px-10 md:py-28 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-6">
  <Image
    src="/images/loalogo.png"
    alt="Late Onset Audiophile logo"
    width={1024}
    height={1024}
    className="h-[72px] w-[72px] object-contain md:h-[96px] md:w-[96px]"
    priority
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
              It starts with real experiences, honest opinions, and the long
              road into better sound. The long-term goal is a premium podcast
              and YouTube brand rooted in music first, gear second, and real
              human perspective throughout.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#story"
                className="rounded-2xl bg-orange-500 px-6 py-3 font-medium text-white transition hover:scale-[1.02]"
              >
                Read the story
              </a>
              <a
                href="#podcast"
                className="rounded-2xl border border-white/15 bg-white/5 px-6 py-3 font-medium text-neutral-100 transition hover:bg-white/10"
              >
                Podcast vision
              </a>
            </div>

            <div className="mt-10 grid max-w-2xl grid-cols-2 gap-4 text-sm text-neutral-300 md:grid-cols-4">
              {[
                "Story first",
                "Podcast-first",
                "Luxury, eventually",
                "Built in public",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 shadow-2xl">
              <Image
                src="/images/loa-hero.jpg"
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

      <section id="story" className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        {/* ...rest of your story section unchanged... */}
      </section>

      {/* keep the remaining sections exactly as you have them */}
    </>
  );
}
