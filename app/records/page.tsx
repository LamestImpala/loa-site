import type { Metadata } from "next";
import { SELLER_INFO } from "@/lib/records";
import { createServerSupabase, type DbRecord } from "@/lib/supabase";
import RecordsClient from "./records-client";

export const metadata: Metadata = {
  title: "Records for Sale — Late Onset Audiophile",
  description:
    "Vinyl records for sale from my personal collection. Graded to the Goldmine standard, shipped in proper LP mailers.",
};

export const revalidate = 60;

export default async function RecordsPage() {
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("records")
    .select(
      "id, artist, title, pressing, media, sleeve, price, notes, photos, discogs_release_id, cover_image, sold, listed, updated_at"
    )
    .eq("listed", true)
    .order("artist");

  const records = (data ?? []) as DbRecord[];

  return (
    <main className="min-h-screen bg-black text-white">
      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
        <h1 className="text-3xl font-semibold md:text-5xl">
          {SELLER_INFO.pageTitle}
        </h1>

        <p className="mt-4 max-w-3xl text-base text-neutral-300 md:text-lg">
          Vinyl from my personal collection, graded to the{" "}
          <a
            href="https://www.discogs.com/selling/resources/how-to-grade-items/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 transition hover:text-white"
          >
            Goldmine standard
          </a>
          . This page updates whenever the list changes — check back for new
          arrivals.
        </p>

        {SELLER_INFO.redditUsername ? (
          <p className="mt-2 text-sm text-neutral-400">
            Sold by{" "}
            <a
              href={`https://www.reddit.com/user/${SELLER_INFO.redditUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 transition hover:text-white"
            >
              u/{SELLER_INFO.redditUsername}
            </a>
          </p>
        ) : null}

        <div className="mt-8 max-w-3xl rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-neutral-300">
          <p>
            <span className="font-medium text-white">Contact:</span>{" "}
            {SELLER_INFO.contact}
          </p>
          <p className="mt-2">
            <span className="font-medium text-white">Payment:</span>{" "}
            {SELLER_INFO.payment}
          </p>
          <p className="mt-2">
            <span className="font-medium text-white">Shipping:</span>{" "}
            {SELLER_INFO.shipping}
          </p>
        </div>

        {error ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-8 text-neutral-300">
            The record list is temporarily unavailable — please check back in a
            minute.
          </div>
        ) : (
          <RecordsClient records={records} />
        )}
      </section>
    </main>
  );
}
