"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { discFace, type DiscStyle } from "@/lib/disc-style";
import { discPixels, discSeed } from "@/lib/disc-paint";

// A coloured pressing shows a sliver of its disc above the cover in the Cards
// and Covers views; on hover it lifts out of the sleeve and turns (shop.css,
// .disc-peek). Plain black never reaches here (discStyle() returns null for
// it) and a picture disc can't be drawn from words, so both show nothing.
// Decoration only: the colour is in words on the record page.
//
// The disc starts as a flat CSS gradient (discFace) and is then painted with
// the 3D crate's own recipe (lib/disc-paint.ts) once it nears the screen, so
// a marble looks like a marble here too.

const SIZE = 320; // canvas pixels; CSS scales it to the cover
// Painted discs, kept so a change of view or filter doesn't paint them again.
const painted = new Map<string, Uint8ClampedArray>();

const idle = (run: () => void) =>
  typeof requestIdleCallback === "function"
    ? requestIdleCallback(run, { timeout: 600 })
    : window.setTimeout(run, 60);
const cancelIdle = (id: number) =>
  typeof cancelIdleCallback === "function" ? cancelIdleCallback(id) : clearTimeout(id);

export function DiscPeek({ id, style }: { id: number; style: DiscStyle | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const show = !!style && style.mode !== "picture" && style.colors.length > 0;
  const key = show
    ? `${id}|${style.mode}|${style.parts ?? ""}|${style.colors.map((c) => c.hex + c.alpha).join("|")}`
    : "";

  useEffect(() => {
    const el = canvas.current;
    if (!el || !style || !key) return;
    let job = 0;
    const paint = () => {
      const ctx = el.getContext("2d");
      if (!ctx) return;
      let pixels = painted.get(key);
      if (!pixels) {
        pixels = discPixels(style, discSeed(id), SIZE);
        painted.set(key, pixels);
      }
      const image = ctx.createImageData(SIZE, SIZE);
      image.data.set(pixels);
      ctx.putImageData(image, 0, 0);
      setReady(true);
    };
    if (painted.has(key)) {
      paint();
      return;
    }
    // Wait until the disc is within a screen or so, then for a quiet moment.
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        job = idle(paint);
      },
      { rootMargin: "700px 0px" }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (job) cancelIdle(job);
    };
    // `key` stands for the style: the same key paints the same disc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);

  if (!show) return null;
  return (
    <span
      className="disc-peek"
      style={{ "--disc": discFace(style) } as CSSProperties}
      aria-hidden="true"
    >
      <span className={`disc-peek-face${ready ? " is-painted" : ""}`}>
        <canvas ref={canvas} width={SIZE} height={SIZE} />
      </span>
    </span>
  );
}
