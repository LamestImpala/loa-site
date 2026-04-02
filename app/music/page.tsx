// app/music/page.tsx
export default function MusicPage() {
  const referenceGroups = [
    {
      title: "Soundstage & imaging",
      description:
        "Tracks that reveal width, depth, and placement – the moments where the speakers disappear.",
      items: [
        {
          track: "Track / Album 1",
          note: "Listen for how instruments occupy distinct spaces without blurring together.",
        },
        {
          track: "Track / Album 2",
          note: "Pay attention to center image focus and depth behind the speakers.",
        },
      ],
    },
    {
      title: "Tone, timbre & realism",
      description:
        "Natural vocals and instruments that tell you if the system sounds believable, not hi-fi for its own sake.",
      items: [
        {
          track: "Track / Album 3",
          note: "Notice the texture of the voice and how acoustic instruments decay.",
        },
        {
          track: "Track / Album 4",
          note: "Listen for body and weight without getting thick or muddy.",
        },
      ],
    },
    {
      title: "Dynamics & impact",
      description:
        "Songs that move from quiet to loud, soft to explosive, without turning into a wall of noise.",
      items: [
        {
          track: "Track / Album 5",
          note: "Focus on how clean the system stays when everything hits at once.",
        },
        {
          track: "Track / Album 6",
          note: "Microdynamics – the small shifts in intensity that make performances feel alive.",
        },
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

      {/* Reference tracks */}
      <section className="mb-20">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
            Reference tracks
          </p>
          <h2 className="mt-4 text-3xl md:text-4xl font-semibold">
            Tracks I use to understand a system.
          </h2>
          <p className="mt-4 max-w-3xl text-lg text-neutral-300">
            These aren&apos;t just demo favorites – they&apos;re songs that
            reveal something specific about how a system handles space, tone,
            and energy. I&apos;ll keep expanding this list as LOA evolves.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {referenceGroups.map((group) => (
            <div
              key={group.title}
              className="rounded-[1.5rem] border border-white/10 bg-neutral-900 p-6"
            >
              <h3 className="text-xl font-semibold text-neutral-50">
                {group.title}
              </h3>
              <p className="mt-3 text-sm text-neutral-300">
                {group.description}
              </p>
              <ul className="mt-5 space-y-4 text-sm text-neutral-100">
                {group.items.map((item) => (
                  <li key={item.track}>
                    <p className="font-medium">{item.track}</p>
                    <p className="mt-1 text-neutral-300">{item.note}</p>
                  </li>
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
