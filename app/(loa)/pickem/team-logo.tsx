"use client";

// A team's logo beside its name. A plain <img>, not next/image: sixty-odd
// tiny marks per page would eat the optimizer quota for nothing, and the
// CDN already serves a small PNG. Renders nothing for a team we do not
// know, and hides itself if the CDN ever 404s, so the name never gets a
// broken-image glyph next to it. alt is empty because the name is text
// right beside it.
import type { League } from "@/lib/pickem";
import { logoUrl } from "@/lib/pickem-logos";

type Props = { league: League; name: string; size?: "sm" | "md" };

const PX = { sm: 16, md: 22 } as const;

export default function TeamLogo({ league, name, size = "md" }: Props) {
  const src = logoUrl(league, name);
  if (!src) return null;
  const px = PX[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see the note above: dozens of 22px marks, not LCP material
    <img
      src={src}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      className="shrink-0 object-contain"
      style={{ width: px, height: px }}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
