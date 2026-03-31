import Link from "next/link";

export default function MySystem() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="border-b border-white/10 bg-neutral-950/95 backdrop-blur-sm px-6 py-4 md:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-neutral-300 hover:text-white transition-colors"
        >
          ← Back to Home
        </Link>
      </nav>

      <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        <div className="text-center mb-20">
          <div className="inline-flex items-center rounded-full border border-orange-400/30 bg-orange-500/10 px-6 py-3 text-sm text-orange-200 mb-8">
            My Hi-Fi System
          </div>
          <h1 className="text-5xl md:text-7xl font-semibold tracking-tight bg-gradient-to-r from-orange-400 via-orange-300 to-yellow-400 bg-clip-text text-transparent">
            My System
          </h1>
        </div>

        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8 lg:col-span-2">
            <p className="text-lg leading-8 text-neutral-300 mb-8">
              My system sits at the intersection of two-channel hi-fi, vinyl,
              digital streaming, and home theater. It has evolved piece by
              piece over time, with every component teaching me something new
              about the kind of sound I connect with most.
            </p>
            <p className="text-neutral-400">
              Right now, my main speakers are the MartinLogan Motion XT F100
              towers, though I am actively upgrading to the Sonus Faber
              Olympica Nova V. The MartinLogans helped show me just how much
              system synergy matters.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-orange-400/20 bg-orange-500/5 p-8">
            <h2 className="text-2xl font-semibold text-orange-200 mb-6">
              Analog Front End
            </h2>
            <ul className="space-y-3 text-neutral-200">
              <li>• Turntable: Clearaudio Concept</li>
              <li>• Tonearm: Clearaudio Satisfy Carbon</li>
              <li>• Phono Preamp: Sutherland 20/20</li>
              <li>• Current Cartridge: Hana Umami Red</li>
            </ul>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
            <h3 className="text-xl font-semibold mb-4">Cartridge Collection</h3>
            <p className="text-neutral-400 mb-4">
              I also keep several other cartridges on hand:
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                "Audio-Technica ART9XI",
                "Soundsmith Zephyr MKIII",
                "Hana MH",
                "Ortofon 2M Black",
                "Ortofon 2M Bronze",
              ].map((cartridge) => (
                <div
                  key={cartridge}
                  className="rounded-xl border border-white/10 bg-neutral-900 p-3 text-sm"
                >
                  {cartridge}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
                <h3 className="text-xl font-semibold mb-4 text-orange-200">
                  Digital Front End
                </h3>
                <ul className="space-y-3 text-neutral-200">
                  <li>• Streamer/DAC/Preamp: Eversolo DMP-A8</li>
                  <li>• Blu-ray Player: Sony Blu-ray player</li>
                  <li>• TV: Sony 77-inch OLED</li>
                </ul>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
                <h3 className="text-xl font-semibold mb-4 text-orange-200">
                  Amplification
                </h3>
                <ul className="space-y-3 text-neutral-200">
                  <li>• Integrated Amp: Marantz PM-10</li>
                  <li>• AV Receiver: Denon AVR-X4800H</li>
                  <li>• Balanced Switcher: Bobwire XLR-1</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="grid md:grid-cols-2 gap-8">
              <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
                <h3 className="text-xl font-semibold mb-4 text-orange-200">
                  Speakers
                </h3>
                <ul className="space-y-3 text-neutral-200">
                  <li>• Current: MartinLogan Motion XT F100</li>
                  <li>• Incoming: Sonus Faber Olympica Nova V</li>
                  <li>• Center: MartinLogan Motion XT C100</li>
                  <li>• Surrounds: 2x in-ceiling</li>
                </ul>
              </div>

              <div className="rounded-[1.75rem] border border-white/10 bg-white/5 p-8">
                <h3 className="text-xl font-semibold mb-4 text-orange-200">
                  Subwoofers
                </h3>
                <ul className="space-y-3 text-neutral-200">
                  <li>• REL S/550</li>
                  <li>• ELAC DS1200</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-orange-400/20 bg-gradient-to-r from-orange-500/10 to-orange-400/5 p-10 mt-12">
            <h2 className="text-3xl font-semibold text-orange-100 mb-6 text-center">
              Where This System Is Going
            </h2>
            <p className="text-lg leading-8 text-neutral-200 text-center max-w-3xl mx-auto">
              The goal stays the same: better connection to music. Detail and
              dynamics, but also warmth, realism, and that feeling that the
              performers are in the room. The Sonus Faber Olympica Nova V will
              reshape everything.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
