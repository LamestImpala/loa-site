// The shop's link-preview card: public/images/brand/share-card.jpg, 1200×630.
// Reddit, iMessage, Discord and Facebook all want about 1.91:1 and an opaque
// image; the old 800×800 transparent logo was cropped to a square and shown
// on black or white depending on the app.
//
// Re-run after changing the art or the words:  node scripts/share-card.mjs
//
// Why a script and not an opengraph-image.tsx route: the card is the same for
// every page that uses it, so there is nothing to render per request, and a
// static JPEG costs no function call on every unfurl. sharp does the artwork,
// as in brand-images.mjs and shop-icons.mjs.
//
// The words are set by next/og (Satori) into a transparent layer and laid
// over the art. sharp's own text goes through Pango, which on macOS only sees
// installed system fonts, so it can't use IM Fell without installing it.
// Satori takes the font files directly and lays the column out with flexbox.
//
// Fonts: IM Fell English (roman + italic) and IM Fell English SC, the faces
// the shop loads through next/font. They are fetched once from Google Fonts
// as TrueType (Satori can't read woff2) and cached in
// node_modules/.cache/share-card-fonts.
import sharp from "sharp";
import { createElement as h } from "react";
// next/og re-exports this for app routes; a plain script imports it directly.
import { ImageResponse } from "next/dist/compiled/@vercel/og/index.node.js";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";

const W = 1200;
const H = 630;
const OUT = "public/images/brand/share-card.jpg";
const CELESTIAL = "assets/brand-source/celestial-observatory.png";
const LOGO = "assets/brand-source/curiouser-engraved-logo.png";

// Palette from app/(shop)/shop.css.
const INK = "#10141f"; // --color-ink-2
const IVORY = "#f3ecdd"; // --color-ink-text
const GOLD = "#cbab6c"; // --color-accent-2-400
const GOLD_SOFT = "#e0c796"; // --color-accent-2-300

const TITLE = "Curiouser Records";
const TAGLINE = "Used vinyl from Phoenix, AZ — graded, packed and shipped by hand";
const DOMAIN = "curiouserrecords.com";

// Layout: emblem on the left over the open sky, words in a column to its right.
const LOGO_SIZE = 500;
const LOGO_X = 50;
const LOGO_Y = Math.round((H - LOGO_SIZE) / 2);
const COL_X = LOGO_X + LOGO_SIZE + 40;
const COL_W = W - COL_X - 60;

// ---- fonts ---------------------------------------------------------------

const FONT_DIR = "node_modules/.cache/share-card-fonts";
const FONTS = [
  { name: "IM Fell English", style: "normal", file: "im-fell-english.ttf" },
  { name: "IM Fell English", style: "italic", file: "im-fell-english-italic.ttf" },
  { name: "IM Fell English SC", style: "normal", file: "im-fell-english-sc.ttf" },
];

async function loadFonts() {
  mkdirSync(FONT_DIR, { recursive: true });
  if (!FONTS.every((f) => existsSync(`${FONT_DIR}/${f.file}`))) {
    // Without a browser user agent, Google Fonts answers with TrueType URLs.
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC",
    ).then((r) => r.text());
    for (const block of css.split("@font-face").slice(1)) {
      const name = block.match(/font-family:\s*'([^']+)'/)?.[1];
      const style = block.match(/font-style:\s*(\w+)/)?.[1];
      const url = block.match(/src:\s*url\(([^)]+\.ttf)\)/)?.[1];
      const font = FONTS.find((f) => f.name === name && f.style === style);
      if (!font || !url) continue;
      writeFileSync(`${FONT_DIR}/${font.file}`, Buffer.from(await fetch(url).then((r) => r.arrayBuffer())));
    }
  }
  return FONTS.map((f) => {
    const path = `${FONT_DIR}/${f.file}`;
    if (!existsSync(path)) throw new Error(`Could not fetch ${f.name} (${f.style})`);
    return { name: f.name, style: f.style, weight: 400, data: readFileSync(path) };
  });
}

// ---- art -----------------------------------------------------------------

// Background: the celestial observatory engraving at the card's width,
// cropped near the top so the moon and the armillary stay in.
const bgH = Math.round((1024 * W) / 1536); // 800
const bg = await sharp(CELESTIAL)
  .resize({ width: W, kernel: "lanczos3" })
  .extract({ left: 0, top: Math.round((bgH - H) * 0.35), width: W, height: H })
  .toBuffer();

// Darken it. The words sit over the armillary, the busiest part, so the
// scrim is heaviest there; the open sky on the left holds the emblem.
const svg = (body) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`);

const scrim = svg(`
  <defs>
    <linearGradient id="x" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${INK}" stop-opacity="0.42"/>
      <stop offset="0.36" stop-color="${INK}" stop-opacity="0.6"/>
      <stop offset="0.5" stop-color="${INK}" stop-opacity="0.8"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.74"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="${INK}" stop-opacity="0"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#x)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>`);

// A soft dark halo behind the emblem so its edge reads against the sky.
const halo = svg(`
  <defs>
    <radialGradient id="h">
      <stop offset="0.55" stop-color="${INK}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${INK}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${LOGO_X + LOGO_SIZE / 2}" cy="${H / 2}" r="${LOGO_SIZE * 0.62}" fill="url(#h)"/>`);

// The shop's double gold rule, as a frame.
const frame = svg(`
  <rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="${GOLD}" stroke-opacity="0.85" stroke-width="2"/>
  <rect x="25" y="25" width="${W - 50}" height="${H - 50}" fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="1"/>`);

const logo = await sharp(LOGO).resize({ width: LOGO_SIZE, kernel: "lanczos3" }).toBuffer();

// ---- words ---------------------------------------------------------------

// Rule, four-point star, rule: the ornament between title and tagline.
const ORN_W = 220;
const c = ORN_W / 2;
const ornament =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ORN_W}" height="20">` +
      `<line x1="0" y1="10" x2="${c - 16}" y2="10" stroke="${GOLD}" stroke-width="1.5"/>` +
      `<line x1="${c + 16}" y1="10" x2="${ORN_W}" y2="10" stroke="${GOLD}" stroke-width="1.5"/>` +
      `<path d="M${c} 1 L${c + 3} 7 L${c + 9} 10 L${c + 3} 13 L${c} 19 L${c - 3} 13 L${c - 9} 10 L${c - 3} 7 Z" fill="${GOLD}"/>` +
      `</svg>`,
  ).toString("base64");

const words = h(
  "div",
  {
    style: {
      width: W,
      height: H,
      display: "flex",
      position: "relative",
      fontFamily: "IM Fell English",
    },
  },
  h(
    "div",
    {
      style: {
        position: "absolute",
        left: COL_X,
        top: 0,
        width: COL_W,
        height: H,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        paddingBottom: 24,
      },
    },
    h("div", { style: { fontSize: 84, lineHeight: 0.98, color: IVORY } }, TITLE),
    h("img", { src: ornament, width: ORN_W, height: 20, style: { margin: "30px 0 28px" } }),
    h(
      "div",
      { style: { fontSize: 38, lineHeight: 1.22, fontStyle: "italic", color: GOLD_SOFT } },
      TAGLINE,
    ),
  ),
  h(
    "div",
    {
      style: {
        position: "absolute",
        left: COL_X,
        bottom: 52,
        fontFamily: "IM Fell English SC",
        fontSize: 28,
        letterSpacing: 1.5,
        color: GOLD,
      },
    },
    DOMAIN,
  ),
);

const fonts = await loadFonts();
const wordsPng = Buffer.from(
  await new ImageResponse(words, { width: W, height: H, fonts }).arrayBuffer(),
);

// ---- card ----------------------------------------------------------------

await sharp(bg)
  .composite([
    { input: scrim },
    { input: halo },
    { input: logo, left: LOGO_X, top: LOGO_Y },
    { input: wordsPng },
    { input: frame },
  ])
  .flatten({ background: INK })
  .jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: "4:4:4" })
  .toFile(OUT);

const kb = Math.round(statSync(OUT).size / 1024);
console.log(`${OUT} ${W}×${H} ${kb} KB`);
if (kb > 300) throw new Error(`${OUT} is ${kb} KB; keep it under 300 KB`);
