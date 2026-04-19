import Link from "next/link";

const upcomingReviews = [
  {
    title: "Sonus Faber Olympica Nova V",
    description:
      "Living with a speaker that changed how I hear tone, texture, and long-term listenability.",
  },
  {
    title: "Dr. Feickert Protractor",
    description:
      "A setup tool that made me realize I had been close, but not quite right.",
  },
  {
    title: "Hana Umami Red Setup Notes",
    description:
      "Cartridge setup, alignment, and what changed once everything finally locked in.",
  },
];

export default function ReviewsPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10 md:py-20">
        <div className="max-w-4xl">
          <div className="mb-6 inline-flex items-center rounded-full border border-orange-400/30 bg-orange-500/10 px-5 py-2 text-sm text-orange-200">
            Late Onset Audiophile Reviews
          </div>

          <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
            Reviews
          </h1>

          <p className="mt-6 max-w-3xl text-lg leading-8 text-neutral-300">
            Real-world listening impressions from a system I actually live with.
            No lab coat reviews, no spec-sheet worship, just honest takes on
            gear that earns its place.
          </p>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
          <Link
            href="/reviews/marantz-pm10-vs-hegel-h390"
            className="group overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 transition hover:border-white/20 hover:bg-white/[0.07]"
          >
            <div className="border-b border-white/10 bg-gradient-to-r from-orange-500/10 via-white/0 to-white/0 px-8 py-8 md:px-10">
              <div className="inline-flex rounded-full border border-orange-400/30 bg-orange-500/10 px-4 py-2 text-xs uppercase tracking-[0.18em] text-orange-200">
                Featured Review
              </div>

              <h2 className="mt-6 text-3xl font-semibold tracking-tight md:text-5xl">
                Marantz PM-10 vs Hegel H390
              </h2>

              <p className="mt-5 max-w-3xl text-base leading-7 text-neutral-300 md:text-lg">
                I bought both amps used and lived with each in my own system.
                Both were impressive, but one sounded more complete, less
                fatiguing, and more emotionally convincing with my speakers.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 text-sm text-neutral-400">
                <span className="rounded-full border border-white/10 px-3 py-1">
                  Integrated Amplifiers
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1">
                  Shootout
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1">
                  8 min read
                </span>
              </div>
            </div>

            <div className="px-8 py-8 md:px-10">
              <div className="rounded-[1.5rem] border border-orange-400/15 bg-gradient-to-r from-orange-500/10 to-white/[0.02] p-6">
                <p className="text-sm uppercase tracking-[0.18em] text-orange-200">
                  Quick verdict
                </p>

                <p className="mt-4 text-lg leading-8 text-neutral-200">
                  The Hegel was very good, but the Marantz sounded more
                  complete, more natural, and easier to listen to for longer
                  sessions. It was the amp that made me stop analyzing and keep
                  playing records.
                </p>

                <div className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-white transition group-hover:text-orange-200">
                  Read Review <span aria-hidden="true">→</span>
                </div>
              </div>
            </div>
          </Link>

          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8">
            <h3 className="text-2xl font-semibold">What You’ll Find Here</h3>

            <p className="mt-5 text-base leading-8 text-neutral-300">
              These reviews are based on real listening in a real living room,
              with gear I’ve used long enough to form an opinion. Sometimes that
              means a clear winner. Sometimes it means the hype did not line up
              with what I heard in my room.
            </p>

            <div className="mt-8 space-y-3">
              {[
                "Long-term listening impressions",
                "Real system matching and synergy",
                "Straight talk on strengths and weaknesses",
                "Setup notes that actually matter",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-neutral-200"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-16">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold md:text-3xl">Coming Soon</h2>
            <p className="text-sm text-neutral-400">
              More reviews and setup impressions are on the way.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {upcomingReviews.map((review) => (
              <div
                key={review.title}
                className="rounded-[1.75rem] border border-white/10 bg-white/5 p-6"
              >
                <div className="inline-flex rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-neutral-400">
                  Coming Soon
                </div>

                <h3 className="mt-5 text-xl font-semibold">{review.title}</h3>

                <p className="mt-4 text-sm leading-7 text-neutral-300">
                  {review.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}