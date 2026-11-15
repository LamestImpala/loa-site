"use client";

/*
 * The hero engraving with its slow drift, star glints and shooting star.
 * The motion itself lives in lib/celestial-motion.mjs (controller) and
 * ../celestial-motion.css (keyframes, pause button, reduced motion); this
 * only mounts them on the shop's own image. Only the engraving moves: the
 * emblem and copy stay outside this element.
 */
import { useEffect, useRef } from "react";
import Image from "next/image";
import { mountCelestialMotion } from "@/lib/celestial-motion.mjs";

export function CelestialArt() {
  const root = useRef<HTMLDivElement>(null);
  // Returns the controller's cleanup, so remounts (and Strict Mode) are safe.
  useEffect(() => mountCelestialMotion(root.current), []);
  return (
    // Not aria-hidden: the pause button inside must reach assistive tech.
    // The image (alt="") and the star overlay are hidden on their own.
    <div ref={root} className="shop-hero-art cr-celestial" data-motion="paused">
      <Image
        src="/images/brand/celestial-2304.webp"
        alt=""
        fill
        priority
        // Not the column's width: on desktop the column is tall and narrow,
        // so the engraving is scaled to its height and drawn about 1,200px
        // wide whatever the window. A narrower hint serves a file that has
        // to be stretched, which is what made the hero look grainy.
        sizes="(max-width: 900px) 100vw, 1200px"
        draggable={false}
        className="shop-hero-art-img cr-celestial__art"
      />
      {/* Static until the controller mounts; hidden if JavaScript is off. */}
      <button className="cr-celestial__toggle" data-motion-toggle type="button" hidden>
        Pause motion
      </button>
    </div>
  );
}
