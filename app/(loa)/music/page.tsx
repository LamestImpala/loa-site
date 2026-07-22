import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Music — Late Onset Audiophile",
  description:
    "How I listen: the qualities I test for, and the listening sessions that reshaped how I think about systems, rooms, and what 'better' actually sounds like.",
};

export default function MusicPage() {
  const focusAreas = [
    {
      title: "Soundstage & imaging",
      description:
        "The moments where the speakers disappear — width, depth, and placement.",
      notes: [
        "Instruments occupying distinct spaces without blurring together",
        "Center image focus and depth behind the speakers",
      ],
    },
    {
      title: "Tone, timbre & realism",
      description:
        "Natural vocals and instruments that tell you if the system sounds believable, not hi-fi for its own sake.",
      notes: [
        "The texture of a voice and how acoustic instruments decay",
        "Body and weight without getting thick or muddy",
      ],
    },
    {
      title: "Dynamics & impact",
      description:
        "Songs that move from quiet to loud, soft to explosive, without turning into a wall of noise.",
      notes: [
        "How clean the system stays when everything hits at once",
        "Microdynamics — the small shifts in intensity that make performances feel alive",
      ],
    },
  ];

  const sessions = [
    {
      title: "Late-night detail session",
      description:
        "Lower volumes, high focus. Records that reward careful listening and reveal what your system can really do when the house is quiet.",
    },
    {
      title: "Vinyl-only Sunday",
      description:
        "Albums you play all the way through – sequencing, side breaks, and the ritual of flipping a record.",
    },
    {
      title: "Turn-it-up test",
      description:
        "Tracks that should feel bigger, more energetic, and more effortless as you raise the volume, not harsh or tiring.",
    },
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
      {/* Hero */}
      <header className="mb-16">
        <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
          Music
        </p>
        <h1 className="mt-4 text-4xl md:text-6xl font-semibold tracking-tight">
          Music that made me care about sound.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-neutral-300">
          This is the listening side of Late Onset Audiophile – the albums and
          tracks that reshaped how I think about systems, rooms, and what
          “better” actually sounds like.
        </p>
      </header>

      {/* Listening philosophy */}
      <section className="mb-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            Listening philosophy
          </p>
          <h2 className="mt-4 text-2xl md:text-3xl font-semibold">
            Music first, test tracks second.
          </h2>
          <p className="mt-6 text-lg leading-8 text-neutral-300">
            Reference tracks are useful, but they only matter if the music
            connects first. I choose songs I know inside and out, then use them
            to understand what a system is doing to tone, timing, and emotion.
          </p>
          <p className="mt-4 text-lg leading-8 text-neutral-300">
            The goal isn&apos;t to collect impressive recordings. It&apos;s to
            build a short list of tracks that quickly tell me about bass
            control, midrange clarity, treble behavior, dynamics, soundstage,
            and fatigue – and still make me want to listen again tomorrow.
          </p>
        </div>

        <div className="rounded-[1.75rem] border border-orange-400/20 bg-orange-500/10 p-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-200">
            What I listen for
          </p>
          <ul className="mt-6 space-y-3 text-neutral-100">
            <li>• Tone and timbre that feel believable, not hyped</li>
            <li>• Imaging that snaps into place without sounding artificial</li>
            <li>• Dynamics that stay controlled when the music gets big</li>
            <li>• Treble that stays detailed without getting sharp or fatiguing</li>
            <li>• Emotional impact – does the performance feel closer?</li>
          </ul>
        </div>
      </section>

      {/* What I test for */}
      <section className="mb-20">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            What I test for
          </p>
          <h2 className="mt-4 text-3xl md:text-4xl font-semibold">
            The three things a system has to get right.
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-neutral-300">
            Every song I reach for when evaluating a change reveals something
            specific about how a system handles space, tone, and energy. These
            are the qualities I&apos;m actually listening for.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {focusAreas.map((area) => (
            <div
              key={area.title}
              className="rounded-[1.5rem] border border-white/10 bg-neutral-900 p-6"
            >
              <h3 className="text-xl font-semibold text-neutral-50">
                {area.title}
              </h3>
              <p className="mt-3 text-sm text-neutral-300">
                {area.description}
              </p>
              <ul className="mt-5 space-y-3 text-sm text-neutral-100">
                {area.notes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Listening sessions */}
      <section>
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            Listening sessions
          </p>
          <h2 className="mt-4 text-3xl md:text-4xl font-semibold">
            Real-world sessions, not lab tests.
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-neutral-300">
            Systems live in messy rooms and real lives. These are the kinds of
            sessions I actually sit down for – the ones that tell me if a setup
            works for the way I listen.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.title}
              className="rounded-[1.5rem] border border-white/10 bg-white/5 p-6"
            >
              <h3 className="text-lg font-semibold text-neutral-50">
                {session.title}
              </h3>
              <p className="mt-3 text-sm leading-7 text-neutral-300">
                {session.description}
              </p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
