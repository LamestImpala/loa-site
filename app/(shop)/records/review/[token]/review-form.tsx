"use client";

import { useState } from "react";
import Link from "next/link";
import { MAX_REVIEW_BODY, MAX_REVIEWER_NAME } from "@/lib/review";

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string }
  | { kind: "done" };

export default function ReviewForm({ token, defaultName }: { token: string; defaultName: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [name, setName] = useState(defaultName);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) {
      setStatus({ kind: "error", message: "Pick a star rating" });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, body, name, website: honeypot }),
      });
      if (res.ok || res.status === 409) {
        setStatus({ kind: "done" });
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus({ kind: "error", message: data?.error || "Couldn't save the review" });
    } catch {
      setStatus({ kind: "error", message: "Couldn't reach the shop — check your connection" });
    }
  }

  if (status.kind === "done") {
    return (
      <div className="review-done" role="status">
        <p>
          <strong>Thank you!</strong> Your review is in. Once I&rsquo;ve had a
          look, it shows with the others on the{" "}
          <Link href="/reviews">reviews page</Link>.
        </p>
        <Link className="btn btn-primary" href="/">
          Browse the records
        </Link>
      </div>
    );
  }

  const shown = hover || rating;
  return (
    <form className="review-form" onSubmit={submit}>
      <fieldset className="review-stars" onMouseLeave={() => setHover(0)}>
        <legend>Your rating</legend>
        <div className="review-stars-row">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={n <= shown ? "is-on" : undefined} onMouseEnter={() => setHover(n)}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => setRating(n)}
              />
              <span aria-hidden="true">★</span>
              <span className="review-sr-only">
                {n} star{n === 1 ? "" : "s"}
              </span>
            </label>
          ))}
          <span className="review-stars-word" aria-hidden="true">
            {RATING_WORDS[shown]}
          </span>
        </div>
      </fieldset>
      <label className="shop-dialog-field">
        <span>Your review</span>
        <textarea
          className="input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={MAX_REVIEW_BODY}
          placeholder="How were the grading, the packing, the records?"
          required
        />
      </label>
      <label className="shop-dialog-field">
        <span>Name to show with it</span>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_REVIEWER_NAME}
          placeholder="e.g. Sam K."
          autoComplete="given-name"
          required
        />
      </label>
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div className="shop-honeypot" aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>
      {status.kind === "error" ? (
        <p className="shop-dialog-error" role="alert">
          {status.message.replace(/[.!?]?$/, ".")}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Sending…" : "Send review"}
      </button>
      <p className="shop-dialog-hint">
        I read every review before it goes on the shop. Only the name above is
        shown — never your email or address.
      </p>
    </form>
  );
}
