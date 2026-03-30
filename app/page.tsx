import Image from "next/image";

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
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.06),transparent_25%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 py-20 md:px-10 md:py-28 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-5 inline-flex items-center rounded-full border border-orange-400/30 bg-orange-500/10 px-4 py-2 text-sm text-orange-200">
              LOA • Late Onset Audiophile
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
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8 lg:col-span-2">
            <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
              The story
            </p>
            <h2 className="mt-4 text-3xl font-semibold md:text-5xl">
              Late onset, not late to meaning.
            </h2>
            <p className="mt-6 text-lg leading-8 text-neutral-300">
              LOA is for people who came to hi-fi later than others and still
              found themselves fully pulled in. Not because they wanted to chase
              specs, but because they started hearing more in the music and
              wanted to understand why.
            </p>
            <p className="mt-4 text-lg leading-8 text-neutral-300">
              This project is about the moments that changed everything:
              realizing amplification matters, understanding speaker placement,
              hearing what a cartridge can do, revisiting favorite albums, and
              learning that better sound can deepen emotional connection.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-orange-400/20 bg-orange-500/10 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-orange-200">
              Mission
            </p>
            <p className="mt-4 text-lg leading-8 text-neutral-100">
              Build a modern audio brand that feels personal, credible, curious,
              and eventually premium without losing the human side that made it
              worth starting.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-white/[0.03]">
        <div className="mx-auto max-w-7xl px-6 py-20 md:px-10">
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
        </div>
      </section>

      <section id="podcast" className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
              Podcast-first vision
            </p>
            <h2 className="mt-4 text-3xl font-semibold md:text-4xl">
              Honest conversations about the audio journey.
            </h2>
            <p className="mt-6 text-lg leading-8 text-neutral-300">
              The podcast will be the heartbeat of LOA. It will focus on the
              personal side of audio: the turning points, the expensive lessons,
              the system changes that actually mattered, and the music that made
              the whole thing worth it.
            </p>
            <p className="mt-4 text-lg leading-8 text-neutral-300">
              Over time, that expands into guest conversations, system stories,
              room discussions, music discovery, and the kind of gear talk that
              stays grounded in real listening.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-neutral-900 p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
              Early episode ideas
            </p>
            <ul className="mt-6 space-y-4 text-neutral-200">
              <li>The upgrade that changed everything</li>
              <li>My biggest hi-fi misconceptions</li>
              <li>Music that made me care about sound</li>
              <li>Used gear wins, misses, and lessons learned</li>
              <li>When I finally understood system synergy</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-20 md:px-10">
        <div className="rounded-[2rem] border border-white/10 bg-gradient-to-r from-orange-500/15 to-white/5 p-8 md:p-10">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            Stay connected
          </p>
          <h2 className="mt-4 text-3xl font-semibold md:text-5xl">
            Follow the LOA journey from the ground up
          </h2>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-neutral-300">
            Follow along for honest thoughts on music, hi-fi gear, room setup,
            upgrades, and the ah-ha moments that make listening better.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="https://instagram.com/lateonsetaudiophile"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-100 transition hover:bg-white/10"
            >
              Instagram
            </a>
            <a
              href="https://x.com/lateonsetaudio"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-100 transition hover:bg-white/10"
            >
              X
            </a>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-200">
              lateonsetaudiophile.com
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}