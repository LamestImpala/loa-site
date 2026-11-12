import Image from "next/image";

// The title page shared by Records, Posters and Equipment: the copy on an
// ivory leaf at left, the celestial-observatory engraving filling the right.
// The emblem heads the copy column rather than sitting on the art, which is
// too busy (moon, armillary, rabbit) to carry it without a fight.
export function ShopHero({ children }: { children: React.ReactNode }) {
  return (
    <div className="shop-hero-band">
      <header className="shop-hero">
        <div className="shop-hero-copy">
          <Image
            src="/images/brand/logo-360.webp"
            alt="Curiouser Records emblem: the White Rabbit with a record and a pocket watch"
            width={360}
            height={360}
            priority
            sizes="180px"
            className="shop-hero-logo"
          />
          {children}
        </div>
        {/* Decorative scene: a single engraving, never tiled. */}
        <div className="shop-hero-art" aria-hidden>
          <Image
            src="/images/brand/celestial-1536.webp"
            alt=""
            fill
            priority
            sizes="(max-width: 760px) 100vw, 48vw"
            className="shop-hero-art-img"
          />
        </div>
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
