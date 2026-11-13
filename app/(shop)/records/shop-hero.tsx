import { CelestialArt } from "./celestial-art";
import { HeroLogo } from "./logo-zoom";

// The title page shared by Records, Posters and Equipment: the copy on an
// ivory leaf at left, the celestial-observatory engraving filling the right.
// The emblem heads the copy column rather than sitting on the art, which is
// too busy (moon, armillary, rabbit) to carry it without a fight. Clicking
// the emblem opens it full size to zoom into the engraving.
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
      <div className="shop-garden-sheet">{children}</div>
    </div>
  );
}
