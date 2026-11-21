// Shop browser-tab and home-screen icons, plus the PayPal invoice logo, all
// cut from the engraved White Rabbit (assets/brand-source).
// Re-run after replacing the logo source: node scripts/shop-icons.mjs
//
// The full emblem can't be read at 16–32px, so the icons are a crop of the
// rabbit's head (ears to chin). The engraving behind the head (gold rings,
// stars, the record's edge, the paw) turns to noise at tab size, so the head
// is lifted out with a colour mask (cream fur + pink ear lining) and set on
// the logo's own navy, with the original background kept faintly for texture
// at large sizes.
import sharp from "sharp";
import { statSync } from "node:fs";

const SRC = "assets/brand-source/curiouser-engraved-logo.png";
const NAVY = { r: 18, g: 27, b: 42 }; // sampled from the emblem's sky

// --- 1. Mask the head, in the logo's 1254px coordinates ---------------------
const R = { left: 340, top: 0, width: 660, height: 600 }; // area around the head
const { data, info } = await sharp(SRC).extract(R).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;

let m = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const r = data[i * C], g = data[i * C + 1], b = data[i * C + 2], a = data[i * C + 3];
  if (a < 100) continue;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const L = (mx + mn) / 2, s = mx === 0 ? 0 : (mx - mn) / mx;
  let h = 0;
  if (mx !== mn) {
    if (mx === r) h = ((g - b) / (mx - mn)) % 6;
    else if (mx === g) h = (b - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const fur = L > 120 && s < 0.32;
  const pink = r > 120 && (h < 22 || h > 330) && s > 0.15 && r - b > 30;
  if (fur || pink) m[i] = 1;
}

// Separable square dilate (grow) / erode (shrink).
function morph(src, rad, grow) {
  const pass = (get) => {
    const o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let k = -rad; k <= rad; k++) {
          const p = get(x, y, k);
          if (grow ? p : !p) { v = grow ? 1 : 0; break; }
        }
        o[y * W + x] = v;
      }
    return o;
  };
  const t = pass((x, y, k) => (x + k < 0 || x + k >= W ? 0 : src[y * W + x + k]));
  return pass((x, y, k) => (y + k < 0 || y + k >= H ? 0 : t[(y + k) * W + x]));
}
m = morph(morph(m, 7, true), 7, false); // close gaps in the engraved lines
m = morph(morph(m, 3, false), 3, true); // drop stray stars and specks

// Keep only the piece joined to the rabbit's cheek.
const keep = new Uint8Array(W * H);
const seed = (380 - R.top) * W + (600 - R.left);
for (const st = [seed], _ = (keep[seed] = 1); st.length; ) {
  const p = st.pop(), x = p % W, y = (p - x) / W;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const q = yy * W + xx;
    if (m[q] && !keep[q]) { keep[q] = 1; st.push(q); }
  }
}
// Fill holes (the dark eye, whiskers): anything not reachable from the edge.
const outside = new Uint8Array(W * H);
const st = [];
for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
while (st.length) {
  const p = st.pop();
  if (outside[p] || keep[p]) continue;
  outside[p] = 1;
  const x = p % W, y = (p - x) / W;
  if (x > 0) st.push(p - 1);
  if (x < W - 1) st.push(p + 1);
  if (y > 0) st.push(p - W);
  if (y < H - 1) st.push(p + W);
}
// Fade the neck and ruff out below the chin (logo y 490 → 545).
const FADE_TOP = 490, FADE_BOTTOM = 545;
const alpha = Buffer.alloc(W * H);
for (let y = 0; y < H; y++) {
  const ly = y + R.top;
  const f = ly <= FADE_TOP ? 1 : ly >= FADE_BOTTOM ? 0 : 1 - (ly - FADE_TOP) / (FADE_BOTTOM - FADE_TOP);
  for (let x = 0; x < W; x++) alpha[y * W + x] = outside[y * W + x] ? 0 : Math.round(255 * f);
}
const softMask = await sharp(alpha, { raw: { width: W, height: H, channels: 1 } }).blur(1.6).extractChannel(0).raw().toBuffer();

// (separate pipelines: sharp would drop the alpha after joining it)
const headRgb = await sharp(SRC).extract(R).removeAlpha().png().toBuffer();
const head = await sharp(headRgb)
  .joinChannel(softMask, { raw: { width: W, height: H, channels: 1 } })
  .png().toBuffer();

// --- 2. Square tile: head on navy ------------------------------------------
// Square in logo coordinates, with a little room above the ear tips.
const SQ = { left: 352, top: -40, side: 620 };

const PAD = -SQ.top; // room added above the logo for the ear tips
const meta = await sharp(SRC).metadata();
// The original sky, veiled to ~15% under a navy wash (texture at 180–512px,
// gone at tab size), with the head laid back on top. Built at full logo size,
// then cut square. Each step is its own pipeline, because sharp runs its
// operations in a fixed order (extract, extend, composite, flatten) whatever
// order they're chained in.
const step = (img) => img.png().toBuffer();
const veil = await step(sharp({ create: { width: meta.width, height: meta.height + PAD, channels: 4, background: { ...NAVY, alpha: 0.85 } } }));
const extended = await step(sharp(SRC).extend({ top: PAD, background: { ...NAVY, alpha: 0 } }));
const flat = await step(sharp(extended).flatten({ background: NAVY }));
const veiled = await step(sharp(flat).composite([{ input: veil }]));
const scene = await step(sharp(veiled).composite([{ input: head, left: R.left, top: R.top + PAD }]));
const tile = await sharp(scene)
  .removeAlpha()
  .extract({ left: SQ.left, top: SQ.top + PAD, width: SQ.side, height: SQ.side })
  .png().toBuffer();

async function save(img, out) {
  await img.toFile(out);
  console.log(out, Math.round(statSync(out).size / 1024) + " KB");
}

await save(sharp(tile).resize(512, 512, { kernel: "lanczos3" }).png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }), "app/(shop)/icon.png");
// iOS home screen: opaque, 180×180.
await save(sharp(tile).resize(180, 180, { kernel: "lanczos3" }).removeAlpha().png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }), "app/(shop)/apple-icon.png");

// --- 3. PayPal invoice logo: the full emblem, 90×90, transparent ------------
// (PayPal caps logos at 250×90. Uploaded by hand to the invoice template;
// see lib/paypal.ts.)
await save(
  sharp(SRC).resize(90, 90, { kernel: "lanczos3" }).sharpen({ sigma: 0.4 }).png({ compressionLevel: 9 }),
  "public/images/curiouser-invoice-logo.png",
);
