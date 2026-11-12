// Web derivatives of the engraved brand art (sources in assets/brand-source).
// Re-run after replacing a source: node scripts/brand-images.mjs
import sharp from "sharp";
import { statSync } from "node:fs";

const src = (f) => `assets/brand-source/${f}`;
const out = (f) => `public/images/brand/${f}`;

const jobs = [
  // Logo keeps its alpha; never cropped or recoloured.
  ...[96, 192, 360, 720].map((w) => ({
    in: "curiouser-engraved-logo.png", out: `logo-${w}.webp`, w, q: 86, alpha: true,
  })),
  { in: "curiouser-engraved-logo.png", out: "logo-share.png", w: 800, png: true },
  ...[960, 1536].map((w) => ({ in: "celestial-observatory.png", out: `celestial-${w}.webp`, w, q: 78 })),
  ...[1000, 1536].map((w) => ({ in: "midnight-garden.png", out: `garden-${w}.webp`, w, q: 74 })),
];

for (const j of jobs) {
  let img = sharp(src(j.in)).resize({ width: j.w });
  img = j.png
    ? img.png({ compressionLevel: 9, palette: true, quality: 90 })
    : img.webp({ quality: j.q, alphaQuality: 90, effort: 6 });
  await img.toFile(out(j.out));
  console.log(j.out, Math.round(statSync(out(j.out)).size / 1024) + " KB");
}
