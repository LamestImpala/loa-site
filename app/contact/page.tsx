export default function ContactPage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-4xl px-4 py-12 md:px-8 md:py-16">
        <h1 className="text-3xl font-semibold md:text-5xl">Contact</h1>

        <p className="mt-4 max-w-2xl text-base text-neutral-300 md:text-lg">
          Questions, podcast ideas, gear talk, or collaboration inquiries —
          feel free to reach out.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-sm uppercase tracking-[0.2em] text-neutral-400">
            Email
          </p>

          <a
            href="mailto:contact@lateonsetaudiophile.com"
            className="mt-3 inline-block text-lg text-neutral-200 underline decoration-neutral-500 underline-offset-4 hover:text-white"
          >
            contact@lateonsetaudiophile.com
          </a>
        </div>
      </section>
    </main>
  );
}