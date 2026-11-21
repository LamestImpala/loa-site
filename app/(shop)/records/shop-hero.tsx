import { CelestialArt } from "./celestial-art";
import { HeroLogo } from "./logo-zoom";

// The title band shared by Records, Posters and Equipment: the emblem and a
// few lines of copy on an ivory leaf at left, a strip of the
// celestial-observatory engraving at right (on top, on phones). It is a
// band, not a title page, so the listings start on the first screen; the
// introduction and buying terms sit under them (buying-terms.tsx). The
// emblem stays off the art, which is too busy (moon, armillary, rabbit) to
// carry it without a fight. Clicking it opens it full size to zoom in.
export function ShopHero({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-hero-band">
      <header className="shop-hero">
        <div className="shop-hero-copy">
          <HeroLogo />
          {children}
        </div>
        {/* Decorative scene: a single engraving, never tiled, drifting slowly. */}
        <CelestialArt />
      </header>
    </div>
  );
}

// Wraps everything below the hero: the midnight-garden wallpaper as the
// wall, with the listings on an ivory sheet hung in front of it.
export function GardenWall({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-garden">
      {/* The engraving: one screen tall, pinned behind the sheet as it
          scrolls past, so it stays in the margins all the way down. */}
      <div className="shop-garden-art" aria-hidden="true" />
      <div className="shop-garden-sheet">{children}</div>
    </div>
  );
}
