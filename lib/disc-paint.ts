// The 3D crate draws each coloured pressing with a small recipe in a shader
// (DISC_FRAGMENT in app/(shop)/records/crate-scene.ts): layered noise for a
// marble, scattered blobs for a splatter, fine grooves, a cream label. This is
// the same recipe in plain numbers, so the disc that peeks out of a cover in
// the Cards and Covers views (app/(shop)/records/disc-peek.tsx) can be painted
// on a 2D canvas without WebGL. Keep the two in step. Same recipe and seed,
// not the same pixels: a graphics card rounds its sums differently.

import type { DiscStyle } from "./disc-style";

// A steady 0–1 number for a record id: the same every visit.
export function hash(n: number, salt: number) {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Where in the noise a record's pattern is cut from; the crate uses the same.
export const discSeed = (id: number) => hash(id, 7) * 40;

const R = 5.85; // the disc's radius in the crate's units

const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
// Works with the edges either way round, as the shader relies on.
function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function h21(x: number, y: number) {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
}

function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = h21(ix, iy);
  const b = h21(ix + 1, iy);
  const c = h21(ix, iy + 1);
  const d = h21(ix + 1, iy + 1);
  return a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy;
}

function fbm(x: number, y: number) {
  let a = 0.5;
  let s = 0;
  for (let k = 0; k < 4; k++) {
    s += a * vnoise(x, y);
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}

// Scattered blobs of varied size on a unit grid. wrap > 0 repeats the grid
// every wrap cells up, so a ring of blobs closes without a seam.
function splat(gx: number, gy: number, seed: number, wrap: number) {
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let m = 0;
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const cx = ix + x;
      const cy = iy + y;
      const ky = wrap > 0 ? cy - wrap * Math.floor(cy / wrap) : cy;
      const r = h21(cx + seed, ky + seed);
      if (r < 0.42) continue;
      const ox = h21(cx + seed + 1.3, ky + seed + 1.3);
      const oy = h21(cx + seed + 2.7, ky + seed + 2.7);
      const rad = 0.1 + 0.34 * r * r;
      const dist = Math.hypot(gx - (cx + ox), gy - (cy + oy));
      const v = smoothstep(rad, rad * 0.78, dist);
      if (v > m) m = v;
    }
  }
  return m;
}

// Value noise that repeats every `per` cells across, so a pattern laid round
// the disc in angle closes without a seam.
function wnoise(x: number, y: number, per: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ix - per * Math.floor(ix / per);
  const x1 = ix + 1 - per * Math.floor((ix + 1) / per);
  const a = h21(x0, iy);
  const b = h21(x1, iy);
  const c = h21(x0, iy + 1);
  const d = h21(x1, iy + 1);
  return a + (b - a) * fx + (c + (d - c) * fx - (a + (b - a) * fx)) * fy;
}

function wfbm(x: number, y: number, per: number) {
  let a = 0.5;
  let s = 0;
  for (let k = 0; k < 4; k++) {
    s += a * wnoise(x, y, per);
    x *= 2;
    y = y * 2.03 + 17.1;
    per *= 2;
    a *= 0.5;
  }
  return s;
}

// Colour-in-colour with a splatter, as it comes out of the press: the two
// colours in long patches round the disc, and streaks of the third shooting
// out from the label, thick near it and thinning toward the rim. u is the
// way round (0–1), r the distance out. Returns [how much B, how much C].
export function sunburst(u: number, r: number, seed: number): [number, number] {
  const w = u + 0.018 * (wfbm(u * 14, r * 0.8 + seed, 14) - 0.5);
  const blot =
    wfbm(w * 11, r * 0.5 + seed, 11) +
    0.35 * (wfbm(w * 36, r * 0.16 + seed + 3.1, 36) - 0.5) +
    0.25 * (wfbm(w * 110, r * 0.08 + seed + 5.3, 110) - 0.5) -
    0.05 * smoothstep(3.0, 4.2, r) * smoothstep(5.6, 4.8, r);
  // Each streak runs its own length out from the label.
  const reach = 3.2 + 3.4 * wfbm(w * 60, seed + 9.4, 60) ** 1.3;
  const thin = smoothstep(2.3, reach, r);
  const streak =
    0.75 * wfbm(w * 150, r * 0.07 + seed * 0.7, 150) + 0.25 * wfbm(w * 150, r * 1.1 + seed + 4.2, 150);
  const edge = 0.34 + 0.2 * thin;
  const ring = smoothstep(2.85, 2.25, r);
  const c = Math.max(smoothstep(edge - 0.03, edge + 0.06, streak), ring * 0.92);
  return [smoothstep(0.29, 0.48, blot), c];
}

// Evenly spaced rings; aa is how far c moves across one pixel.
function lines(c: number, w: number, aa: number) {
  const f = Math.abs(fract(c) - 0.5);
  const l = 1 - smoothstep(w - aa, w + aa, f);
  // Finer than a pixel, the rings settle to their average tone.
  return l + (w * 2 - l) * smoothstep(0.25, 0.6, aa);
}

type Rgba = [number, number, number, number];

function rgba(hex: string, alpha: number): Rgba {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

const MODES: Record<string, number> = {
  solid: 0,
  marble: 1,
  splatter: 2,
  split: 3,
  inner: 4,
  stripes: 5,
  wedges: 6,
  sunburst: 7,
};

const CREAM = [0.93, 0.89, 0.81];
const GOLD = [0.71, 0.55, 0.28];
const MAROON = [0.49, 0.19, 0.3];

// The disc as size × size RGBA bytes (straight alpha), clear outside the
// circle. A see-through pressing keeps its alpha, as it does in the crate.
export function discPixels(style: DiscStyle, seed: number, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  if (style.colors.length === 0) return out;
  const cols = [0, 1, 2].map((k) => {
    const c = style.colors[Math.min(k, style.colors.length - 1)];
    return rgba(c.hex, c.alpha);
  });
  const [A, B, C] = cols;
  const count = style.colors.length;
  const mode = MODES[style.mode] ?? 0;
  const parts = style.parts ?? 8;
  const px = (2 * R) / size; // one pixel, in the crate's units
  const base: Rgba = [0, 0, 0, 0];
  const mix = (from: Rgba, to: Rgba, t: number) => {
    for (let k = 0; k < 4; k++) base[k] = from[k] + (to[k] - from[k]) * t;
  };

  for (let j = 0; j < size; j++) {
    const y = (1 - ((j + 0.5) / size) * 2) * R;
    for (let i = 0; i < size; i++) {
      const x = (((i + 0.5) / size) * 2 - 1) * R;
      const r = Math.hypot(x, y);
      if (r > R) continue;
      const ang = Math.atan2(y, x);

      mix(A, A, 0);
      if (mode === 1) {
        const qx = x * 0.3 + seed;
        const qy = y * 0.3 + seed;
        const w = fbm(qx + 1.7 * fbm(qx + 3.1, qy + 3.1), qy + 1.7 * fbm(qx + 7.7, qy + 7.7));
        mix(A, B, smoothstep(0.4, 0.6, w));
        if (count > 2) {
          mix([...base], C, smoothstep(0.56, 0.7, fbm(qx * 1.6 + 9, qy * 1.6 + 9)));
        }
      } else if (mode === 2) {
        // 28 cells round the ring (4.456 a radian), so it meets itself.
        const m = Math.max(
          splat(x * 0.95 + seed, y * 0.95 + seed, 1, 0),
          splat(r * 1.25 + seed, ang * 4.456338 + seed, 5, 28)
        );
        mix(A, B, m);
        if (count > 2) mix([...base], C, splat(x * 1.3 - seed, y * 1.3 - seed, 9, 0));
      } else if (mode === 3) {
        mix(B, A, smoothstep(-0.04, 0.04, y + x * 0.12));
      } else if (mode === 4) {
        const wob =
          (fbm(Math.cos(ang) * 1.6 + seed, Math.sin(ang) * 1.6 + seed) - 0.5) * 1.6;
        mix(B, A, smoothstep(3.75 + wob, 3.4 + wob, r));
      } else if (mode === 5) {
        const band = ((y / R) * 0.5 + 0.5) * count;
        mix(A, band < 1 ? A : band < 2 ? B : C, 1);
      } else if (mode === 7) {
        const [b, c] = sunburst(ang / (Math.PI * 2) + 0.5, r, seed);
        mix(A, B, b);
        mix([...base], C, c);
      } else if (mode === 6) {
        const turn = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * parts);
        const wedge = turn - count * Math.floor(turn / count);
        mix(A, wedge < 0.5 ? A : wedge < 1.5 ? B : C, 1);
      }

      let cr = base[0];
      let cg = base[1];
      let cb = base[2];
      let alpha = base[3];
      const lum = cr * 0.3 + cg * 0.6 + cb * 0.1;
      const pressed = r >= 2.35 && r <= 5.6 ? 1 : 0;
      const groove = lines(r * 5.5, 0.11, 5.5 * px) * pressed;
      // Grooves read as fine dark rings on colour, and catch a little light
      // on a dark one. The moving sheen is laid over in CSS (.disc-peek::after).
      const dark = 1 - 0.16 * groove * smoothstep(0.06, 0.25, lum);
      const bright = smoothstep(0.06, 0.3, lum);
      const glint = groove * 0.05 * (1 - 0.4 * bright);
      cr = cr * dark + glint * (0.88 + 0.12 * bright);
      cg = cg * dark + glint * (0.76 + 0.24 * bright);
      cb = cb * dark + glint * (0.5 + 0.5 * bright);
      alpha += (1 - alpha) * clamp01(groove * 0.12) * pressed;
      // A thin rim so a clear disc still has an edge.
      alpha += (1 - alpha) * smoothstep(5.74, 5.82, r) * 0.5;

      if (r < 2.15) {
        const ring = lines(r * 2.6 + 0.27, 0.05, 2.6 * px);
        const centre = r <= 0.62 ? 0.9 : 0;
        // Two short lines of "print" on one side, so a one-colour disc can
        // still be seen to turn.
        const off = Math.abs(ang - Math.PI / 2);
        const print =
          (r > 1.22 && r < 1.36 && off < 0.95) || (r > 1.5 && r < 1.6 && off < 0.6) ? 0.45 : 0;
        const tone = (k: number) => {
          let v = CREAM[k] + (GOLD[k] - CREAM[k]) * ring;
          v += (MAROON[k] - v) * centre;
          return v + (MAROON[k] - v) * print;
        };
        cr = tone(0);
        cg = tone(1);
        cb = tone(2);
        alpha = 1;
      }
      if (r < 0.15) cr = cg = cb = 0.03;
      // Soften the outer edge by a pixel.
      alpha *= 1 - smoothstep(R - px, R, r);

      const at = (j * size + i) * 4;
      out[at] = cr * 255;
      out[at + 1] = cg * 255;
      out[at + 2] = cb * 255;
      out[at + 3] = alpha * 255;
    }
  }
  return out;
}
