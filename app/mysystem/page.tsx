import Link from "next/link";

export default function MySystem() {
  const cartridges = [
    "Hana Umami Red",
    "Audio-Technica ART9XI",
    "Soundsmith Zephyr MKIII",
    "Hana MH",
    "Ortofon 2M Black",
    "Ortofon 2M Bronze",
  ];

  const analogFrontEnd = [
    "Turntable: Clearaudio Concept",
    "Tonearm: Clearaudio Satisfy Carbon",
    "Phono Preamp: Sutherland 20/20",
    "Current Cartridge: Hana Umami Red",
  ];

  const digitalFrontEnd = [
    "Streamer/DAC/Preamp: Eversolo DMP-A8",
    "Blu-ray Player: Sony Blu-ray player",
    "TV: Sony 77-inch OLED",
  ];

  const amplification = [
    "Integrated Amp: Marantz PM-10",
    "AV Receiver: Denon AVR-X4800H",
  ];

  const speakers = [
    "Main Speakers: Sonus Faber Olympica Nova V",
    "Center: MartinLogan Motion XT C100",
    "Surrounds: 2x in-ceiling",
  ];

  const subwoofers = ["REL S/550", "ELAC DS1200"];

  return (
    <section className="mx-auto max-w-7xl px-6 py-16 md:px-10 md:py-20">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-300 transition-colors hover:text-white"
        >
          ← Back to Home
        </Link>
      </div>

      <div className="mb-20 text-center">
        <div className="mb-8 inline-flex items-center rounded-full border border-orange-400/30 bg-orange-500/10 px-6 py-3 text-sm text-orange-200">
          My Hi-Fi System
        </div>

        <h1 className="bg-gradient-to-r from-orange-400 via-orange-300 to-yellow-400 bg-clip-text text-5xl font-semibold tracking-tight text-transparent md:text-7xl">
          My System
        </h1>

        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-neutral-300">
          The system that shaped Late Onset Audiophile lives at the intersection
          of two-channel hi-fi, vinyl, digital streaming, and home theater.
          Every component here taught me something about synergy, tone, scale,
          and what kind of sound keeps me listening longer.
        </p>
      </div>

      <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8 lg:col-span-2">
          <p className="mb-8 text-lg leading-8 text-neutral-300">
            My system has evolved piece by piece over time, with every upgrade
            clarifying what matters most to me: musical connection first,
            technical performance second, and long-term listenability over
            short-term fireworks.
          </p>

          <p className="text-neutral-400">
            Right now, the heart of the system is built around the Sonus Faber
            Olympica Nova V, supported by carefully chosen analog and digital
            sources that keep me engaged for hours at a time.
          </p>
        </div>

        <div className="rounded-[1.75rem] border border-orange-400/20 bg-orange-500/5 p-8">
          <h2 className="mb-6 text-2xl font-semibold text-orange-200">
            Analog Front End
          </h2>

          <ul className="space-y-3 text-neutral-200">
            {analogFrontEnd.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
          <h2 className="mb-4 text-xl font-semibold">Cartridge Collection</h2>
          <p className="mb-4 text-neutral-400">
            I also keep several other cartridges on hand:
          </p>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {cartridges.map((cartridge) => (
              <div
                key={cartridge}
                className="rounded-xl border border-white/10 bg-neutral-900 p-3 text-sm text-neutral-100"
              >
                {cartridge}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
              <h2 className="mb-4 text-xl font-semibold text-orange-200">
                Digital Front End
              </h2>

              <ul className="space-y-3 text-neutral-200">
                {digitalFrontEnd.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
              <h2 className="mb-4 text-xl font-semibold text-orange-200">
                Amplification
              </h2>

              <ul className="space-y-3 text-neutral-200">
                {amplification.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
              <h2 className="mb-4 text-xl font-semibold text-orange-200">
                Speakers
              </h2>

              <ul className="space-y-3 text-neutral-200">
                {speakers.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
              <h2 className="mb-4 text-xl font-semibold text-orange-200">
                Subwoofers
              </h2>

              <ul className="space-y-3 text-neutral-200">
                {subwoofers.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-[2rem] border border-orange-400/20 bg-gradient-to-r from-orange-500/10 to-orange-400/5 p-10 lg:col-span-2">
          <h2 className="mb-6 text-center text-3xl font-semibold text-orange-100">
            Where This System Is Going
          </h2>

          <p className="mx-auto max-w-3xl text-center text-lg leading-8 text-neutral-200">
            The goal stays the same: better connection to music. Detail and
            dynamics, but also warmth, realism, and that feeling that the
            performers are in the room. The Sonus Faber Olympica Nova V will
            continue to shape the system, but the real point is deeper emotional
            return from every listening session.
          </p>
        </div>

        <div className="lg:col-span-2">
          <div className="flex flex-wrap gap-4">
            <Link
              href="/music"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-100 transition hover:bg-white/10"
            >
              Explore Music
            </Link>

            <Link
              href="/reviews"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-100 transition hover:bg-white/10"
            >
              Read Reviews
            </Link>

            <Link
              href="/podcast"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-100 transition hover:bg-white/10"
            >
              Podcast Vision
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}