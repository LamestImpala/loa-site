import Link from "next/link";

export default function MySystem() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-neutral-300 hover:text-white transition-colors text-sm"
        >
          ← Back to Home
        </Link>
      </div>

      <div className="text-center mb-20">
        {/* ...rest of your My System content unchanged... */}
      </div>

      {/* keep all other sections (Analog Front End, etc.) unchanged */}
    </section>
  );
}
