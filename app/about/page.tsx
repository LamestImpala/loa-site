import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — Late Onset Audiophile",
  description:
    "The story behind Late Onset Audiophile — a personal journey into hi-fi, vinyl, and the music that made better sound worth caring about.",
};

export default function AboutPage() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20 text-white">
      <h1 className="text-4xl font-semibold">About</h1>

      <div className="mt-6 max-w-3xl space-y-5 text-neutral-300 leading-8">
        <p>
          Late Onset Audiophile is my personal space to document what happened
          when a casual interest in better sound turned into a much deeper dive
          into hi-fi, vinyl, music discovery, system building, and room setup.
          What started as simply wanting better sound became a real passion for
          the gear, the process, and most importantly, the connection to music.
        </p>

        <p>
          This site is not meant to be a sterile review page or a collection of
          specs for the sake of specs. It is about the journey of learning what
          actually makes a system come alive, making upgrades over time, hearing
          the difference, and figuring out how all the pieces work together.
          Some of the biggest ah-ha moments in my own system came from amplifier
          upgrades, better system matching, cartridge changes, and learning how
          much the room shapes the final result.
        </p>

        <p>
          Late Onset Audiophile is where I share that process through my system,
          the records I love, the gear I have used, and what I am still learning
          along the way. If you are getting deeper into this hobby later than
          expected, or you are just trying to build a system that pulls you
          closer to the music, you are in the right place. It&apos;s never too
          late to hear what you&apos;ve been missing.
        </p>
      </div>

      <div className="mt-12 grid gap-8 md:grid-cols-2">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            The story
          </p>
          <h2 className="mt-4 text-2xl font-semibold md:text-3xl">
            Late onset, not late to meaning.
          </h2>
          <p className="mt-5 leading-8 text-neutral-300">
            LOA is for people who came to hi-fi later than others and still
            found themselves fully pulled in. Not because they wanted to chase
            specs, but because they started hearing more in the music and
            wanted to understand why. It&apos;s about the moments that changed
            everything: realizing amplification matters, understanding speaker
            placement, hearing what a cartridge can do, and learning that
            better sound can deepen emotional connection.
          </p>
        </div>

        <div className="rounded-[1.75rem] border border-orange-400/20 bg-orange-500/10 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-200">
            Where this is going
          </p>
          <p className="mt-5 leading-8 text-neutral-100">
            The long-term goal is a premium podcast and YouTube brand rooted in
            music first, gear second, and real human perspective throughout —
            honest conversations about the turning points, the expensive
            lessons, and the music that made the whole thing worth it. Built in
            public, one piece at a time.
          </p>
        </div>
      </div>
    </section>
  );
}
