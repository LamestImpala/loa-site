import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "My System — Late Onset Audiophile",
  description:
    "The hi-fi system behind Late Onset Audiophile: Sonus Faber Olympica Nova V, Marantz PM-10, Eversolo DMP-A8, Clearaudio Concept Signature Black, and more.",
};

export default function MySystem() {
  const cartridges = [
    {
      name: "Hana Umami Red",
      url: "https://www.hanacartridges.com/products/hana-umami-red",
    },
    {
      name: "Audio-Technica ART9XI",
      url: "https://www.audio-technica.com/en-us/at-art9xi",
    },
    {
      name: "Soundsmith Zephyr MKIII",
      url: "https://www.sound-smith.com/cartridges/fixed-coil/zephyr-mk-iii",
    },
    {
      name: "Ortofon 2M Black",
      url: "https://ortofon.com/products/2m-black",
    },
    {
      name: "Ortofon 2M Bronze",
      url: "https://ortofon.com/products/2m-bronze",
    },
  ];

  const analogFrontEnd = [
    "Turntable: Clearaudio Concept Signature Black",
    "Tonearm: Clearaudio Tracer",
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
      <header className="mb-16">
        <p className="text-sm uppercase tracking-[0.3em] text-orange-300">
          My Hi-Fi System
        </p>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">
          My System
        </h1>

        <p className="mt-5 max-w-3xl text-lg leading-8 text-neutral-300">
          The system that shaped Late Onset Audiophile lives at the intersection
          of two-channel hi-fi, vinyl, digital streaming, and home theater.
          Every component here taught me something about synergy, tone, scale,
          and what kind of sound keeps me listening longer.
        </p>
      </header>

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
              <a
                key={cartridge.name}
                href={cartridge.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-white/10 bg-neutral-900 p-3 text-sm text-neutral-100 transition hover:border-white/25 hover:bg-neutral-800 hover:text-white"
              >
                {cartridge.name}
              </a>
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
              href="https://curiouserrecords.com"
              className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm text-neutral-100 transition hover:bg-white/10"
            >
              Records for Sale
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}