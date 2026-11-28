// The 3D record bin behind the Crate view (crate-3d.tsx mounts it).
//
// An ebonized walnut crate under soft studio light: box-jointed corner posts,
// thick rounded rails along the front and sloping sides, aged brass on the
// lower front corners, and an oxblood leather inset on the front with the
// shop's name stamped in gold. The real listing
// covers are on the sleeves. The record you stop on
// lifts out and turns to face you, and its disc slides out in the colour
// Discogs describes for the pressing (lib/disc-style.ts).
//
// Everything is lit physically (image light from a soft room plus a warm key
// light that casts shadows), and the wood, leather, foil and vinyl are drawn by small
// shaders added to three's own materials, so there are no texture files.
//
// This module is the only place three.js is imported, and crate-3d.tsx loads
// it with import() so the catalog doesn't pay for it until the Crate view opens.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { DiscStyle } from "@/lib/disc-style";
import { discSeed, hash } from "@/lib/disc-paint";

export type CrateItem = {
  id: number;
  cover: string | null; // same-origin image URL (WebGL can't read Discogs directly)
  initials: string; // drawn on a tinted sleeve when there is no cover
  sticker: string[]; // ["$82", "NM/NM"], or ["Sold"]
  sold: boolean;
  tab: string | null; // divider letter where a new one starts (A–Z sort only)
  disc: DiscStyle | null;
};

export type CrateScene = {
  // Show `items` with the one at `index` lifted. `fall` = arrived by
  // "Down the rabbit hole": the record tumbles in from above.
  update(items: CrateItem[], index: number, fall?: boolean): void;
  // Which position in `items` is under this point of the screen; -1 = none.
  pick(clientX: number, clientY: number): number;
  dispose(): void;
};

// Lit scene: colours go through three's colour management (sRGB in, sRGB out).
THREE.ColorManagement.enabled = true;

// A palette hex used exactly as written by the unlit shaders (stars, ground),
// which write straight to the screen.
const raw = (hex: number) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
const PAPER = new THREE.Color(0xe9dfc9);

// Sleeve and bin measurements, in inches-ish.
const H = 12.3;
const T = 0.14;
const W_IN = 13.5;
const WALL = 0.5;
const FLOOR = 0.3;
const Z_FRONT = 5.4;
const Z_BACK = -9.0;
const H_FRONT = 4.6;
const H_BACK = 9.2;
// Radius of the rounded walnut rails along the front and sloping sides.
const RAIL = 0.42;
const OUTER_W = W_IN + WALL * 2;
const DEPTH = Z_FRONT - Z_BACK + WALL * 2;
const Z_MID = (Z_FRONT + Z_BACK) / 2;
// Box joints: roughly how tall each interlocking finger is.
const FINGER = 1.0;

// How many sleeves stand behind the lifted one, how many lean flipped in front.
const BEHIND = 16;
const FLIPPED = 5;
const GAP = 0.44;
const LEAN_B = 0.17;
const LEAN_F = 0.35;
const Z_B_REST = -7.3;
// The front-most flipped sleeve rests against the inside of the front rail,
// touching it where the rail's curve runs parallel to the sleeve.
const Z_F_REST = (() => {
  const nz = Math.cos(LEAN_F);
  const ny = -Math.sin(LEAN_F);
  const off = RAIL + T / 2 + 0.03;
  const qz = Z_FRONT + RAIL - off * nz;
  const qy = H_FRONT - RAIL - off * ny;
  return qz + ((FLOOR - qy) / Math.cos(LEAN_F)) * Math.sin(LEAN_F);
})();

const CAM = { az: 0.38, el: 0.36, fov: 27, dist: 62, target: new THREE.Vector3(0.2, 10.6, -1.2) };
const HELD = { x: -1.3, y: 10.3, z: 0.9, rx: -0.3, ry: CAM.az };

const TINTS = [
  ["#ecdae0", "#582236"],
  ["#efe1c3", "#574423"],
  ["#ece4d4", "#423b4a"],
  ["#dfb4c4", "#371522"],
];
const COVER_CACHE_MAX = 80;
// Covers fetched ahead of the sleeves on show, so a flip rarely waits on one.
const WARM_AHEAD = 6;
const WARM_BACK = 3;
// A sleeve whose cover is still on its way: quiet ink, not a bright card.
const BLANK = "#262c42";

const LINES_GLSL = `
  float lines(float c, float w) {
    float f = abs(fract(c) - 0.5);
    float aa = fwidth(c);
    float l = 1.0 - smoothstep(w - aa, w + aa, f);
    // Far away the lines are finer than a pixel: settle to their average tone.
    return mix(l, w * 2.0, smoothstep(0.25, 0.6, aa));
  }
`;

const WORLD_VERTEX = `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Bump a lit surface by a height computed in the shader (three's own
// perturbNormalArb, which is only compiled in when a material has a bump map).
const BUMP_GLSL = `
  vec3 crateBump(vec3 surfPos, vec3 surfNorm, float h, float scale, float faceDir) {
    vec2 dH = vec2(dFdx(h), dFdy(h)) * scale;
    vec3 sx = normalize(dFdx(surfPos));
    vec3 sy = normalize(dFdy(surfPos));
    vec3 r1 = cross(sy, surfNorm);
    vec3 r2 = cross(surfNorm, sx);
    float det = dot(sx, r1) * faceDir;
    vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
    return normalize(abs(det) * surfNorm - grad);
  }
`;

// ── wood ──
//
// Ebonized walnut worked out from each board's own coordinates (seeded per
// board), so the grain runs across the front, front-to-back along the sides
// and lengthwise on each rail, and the ends show growth rings, which is what
// makes the joinery read. Deep brown-black with warm grain, rubbed warmer on
// the rounded rails where hands go, quieter on the broad side faces. Detail
// finer than a screen pixel fades to its average so the grain doesn't shimmer.
const WOOD_PARS = `
  varying vec3 vLocal;
  varying vec3 vLocalN;
  varying vec3 vWorldP;
  varying vec3 vWorldN;
  uniform vec3 uHalf;     // half the board's size
  uniform int uAxis;      // the grain runs along 0: x, 1: z, 2: y
  uniform float uSeed;
  uniform float uRound;   // 1 = a rounded rail: rubbed on top, not worn along box edges
  uniform sampler2D uPlaque;
  uniform float uHasPlaque;
  uniform vec4 uPanel;    // the leather inset on the front board, in texture coordinates
  float wHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float wNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float wFbm(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int k = 0; k < 3; k++) {
      s += a * wNoise(p);
      p = p * 2.07 + 11.3;
      a *= 0.5;
    }
    return s / 0.875;
  }
  ${BUMP_GLSL}
`;

const WOOD_COLOR = `
  vec3 wp = vLocal;
  vec3 wq = (uAxis == 0 ? wp.xyz : (uAxis == 1 ? wp.zyx : wp.yxz)) + uSeed;
  // About how many inches one screen pixel covers here.
  float wPx = length(fwidth(wp));
  // Growth rings around a far-off heart, warped so they wander like real grain.
  float wWarp = wFbm(vec3(wq.x * 0.11, wq.yz * 0.9));
  float wRing = length(wq.yz + vec2(5.0, -11.0)) * 1.6 + wWarp * 2.4 + wq.x * 0.025;
  float wRf = fract(wRing);
  float wLate = smoothstep(0.5, 0.82, wRf) * (1.0 - smoothstep(0.86, 1.0, wRf));
  wLate = mix(wLate, 0.22, smoothstep(0.14, 0.3, wPx));
  float wStreak = mix(wNoise(vec3(wq.x * 0.3, wq.y * 9.0, wq.z * 9.0)), 0.5, smoothstep(0.05, 0.12, wPx));
  float wMid = mix(wNoise(vec3(wq.x * 0.4, wq.y * 22.0, wq.z * 22.0)), 0.5, smoothstep(0.025, 0.06, wPx));
  float wFine = mix(wNoise(vec3(wq.x * 0.6, wq.y * 55.0, wq.z * 55.0)), 0.5, smoothstep(0.009, 0.02, wPx));
  float wGrain = clamp(wLate * 0.6 + smoothstep(0.35, 0.85, wStreak) * 0.45 + wMid * 0.25 + wFine * 0.15 - 0.2, 0.0, 1.0);
  float wTone = wFbm(vec3(wq.x * 0.08, wq.yz * 0.5) + 4.0);

  // Distance to the nearest edge of the board.
  vec3 wd = uHalf - abs(wp);
  float wMin = min(wd.x, min(wd.y, wd.z));
  float wMax = max(wd.x, max(wd.y, wd.z));
  float wEdge = uRound > 0.5 ? 1.0 : wd.x + wd.y + wd.z - wMin - wMax;
  float wN1 = wFbm(wp * 2.6 + uSeed * 7.0);
  float wWear = 1.0 - smoothstep(0.006, 0.03 + 0.11 * wN1 * wN1, wEdge);
  wWear *= smoothstep(0.42, 0.62, wN1 + 0.3 * wNoise(wp * 11.0));
  float wScuff = (1.0 - uRound) * smoothstep(0.76, 0.84, wFbm(wp * vec3(1.1, 5.0, 1.1) + 3.0 + uSeed)) * 0.25;
  wWear = clamp(max(wWear * 1.2, wScuff), 0.0, 1.0);

  // Broad side faces sit darker and quieter; rail tops are rubbed warm.
  float wSide = (1.0 - uRound) * smoothstep(0.75, 0.95, abs(vWorldN.x));
  float wRub = uRound * smoothstep(0.05, 0.85, vWorldN.y) * (0.5 + 0.5 * wN1);

  vec3 wBody = mix(vec3(0.028, 0.0095, 0.0042), vec3(0.014, 0.005, 0.0025), wTone);
  vec3 wWarm = mix(vec3(0.1, 0.034, 0.012), vec3(0.18, 0.06, 0.02), wMid);
  vec3 wCol = mix(wBody, wWarm, wGrain * (0.85 - 0.4 * wSide));
  wCol = mix(wCol, mix(vec3(0.07, 0.024, 0.009), vec3(0.15, 0.05, 0.017), wGrain), wRub * 0.75);
  vec3 wBare = mix(vec3(0.16, 0.058, 0.02), vec3(0.3, 0.12, 0.045), clamp(wGrain * 0.5 + wN1 * 0.5, 0.0, 1.0));
  wCol = mix(wCol, wBare, wWear);
  wCol *= 1.0 - 0.25 * wSide;
  float wRough = mix(0.5 + wGrain * 0.1, 0.33 + wGrain * 0.08, uRound);
  wRough = mix(wRough, 0.62, wWear) + 0.15 * wSide;
  float wMetal = 0.0;
  float wHeight = wGrain * 0.5 + wStreak * 0.25 - wWear * 0.6;

  // The front board: a shallow oxblood leather inset in a walnut frame, the
  // shop's name stamped in muted gold, a fine pressed border and a sprig
  // blind-tooled in each corner. Sampled outside the branch so mipmapping works.
  vec2 puv = wp.xy / (uHalf.xy * 2.0) + 0.5;
  vec4 pm = texture2D(uPlaque, puv);
  // Pressed marks: shadow on the side away from the light (upper left), a
  // faint catch of light on the other.
  vec2 po = vec2(0.0011, 0.0034);
  vec4 pmUL = texture2D(uPlaque, puv + vec2(-po.x, po.y));
  vec4 pmDR = texture2D(uPlaque, puv + vec2(po.x, -po.y));
  if (uHasPlaque > 0.5 && vLocalN.z > 0.9) {
    // Inches inside the leather's edge (negative: out on the wood frame).
    vec2 pIn = min(puv - uPanel.xy, uPanel.zw - puv) * uHalf.xy * 2.0;
    float pd = min(pIn.x, pIn.y);
    float inLeather = smoothstep(-0.008, 0.008, pd);
    float recess = inLeather * (1.0 - smoothstep(0.0, 0.18, pd));
    float lip = (1.0 - inLeather) * (1.0 - smoothstep(0.0, 0.04, -pd));
    float lGrain = mix(wNoise(wp * 34.0) * 0.6 + wNoise(wp * 75.0) * 0.4, 0.5, smoothstep(0.008, 0.025, wPx));
    float lTone = wFbm(wp * 1.6 + 2.0);
    vec3 leather = mix(vec3(0.09, 0.0095, 0.008), vec3(0.034, 0.0038, 0.0032), lTone * 0.85 + lGrain * 0.3);
    wCol = mix(wCol, leather, inLeather);
    wCol *= 1.0 - recess * 0.6;
    wCol += lip * vec3(0.05, 0.022, 0.009);

    float tHere = max(pm.r, pm.b);
    float tShade = max(tHere - max(pmUL.r, pmUL.b), 0.0);
    float tCatch = max(tHere - max(pmDR.r, pmDR.b), 0.0);
    wCol = mix(wCol, wCol * 0.42, pm.b * inLeather);
    float foil = pm.r * smoothstep(0.1, 0.4, wNoise(wp * 9.0) + 0.45);
    vec3 gold = mix(vec3(0.4, 0.25, 0.085), vec3(0.6, 0.41, 0.16), wNoise(wp * 4.0));
    wCol = mix(wCol, gold, foil);
    wCol *= 1.0 - 0.5 * tShade * inLeather;
    wCol += tCatch * inLeather * vec3(0.06, 0.04, 0.02);

    wRough = mix(wRough, 0.52 + lGrain * 0.18 - pm.b * 0.12, inLeather);
    wRough = mix(wRough, 0.34 + 0.1 * wN1, foil);
    wMetal = foil * 0.9;
    wHeight = mix(wHeight, -0.35 + lGrain * 0.35, inLeather) - pm.r * 0.4 - pm.b * 0.35;
  }
  diffuseColor.rgb = wCol;
`;

// Inside the bin the room light falls away toward the floor.
const WOOD_OCCLUSION = `
  {
    float inside = step(abs(vWorldP.x), ${(W_IN / 2 + 0.02).toFixed(3)})
      * step(vWorldP.z, ${(Z_FRONT + 0.02).toFixed(3)})
      * step(${(Z_BACK - 0.02).toFixed(3)}, vWorldP.z);
    float rim = mix(${H_FRONT.toFixed(2)}, ${H_BACK.toFixed(2)}, clamp((${Z_FRONT.toFixed(2)} - vWorldP.z) / ${(Z_FRONT - Z_BACK).toFixed(2)}, 0.0, 1.0));
    float occ = mix(1.0, mix(0.22, 1.0, smoothstep(0.0, rim, vWorldP.y)), inside);
    reflectedLight.indirectDiffuse *= occ;
    // Broad side faces seen edge-on shouldn't mirror the room.
    reflectedLight.indirectSpecular *= occ * (1.0 - 0.6 * wSide);
  }
`;

// The black disc everything without a colour gets; and the pattern recipe for
// coloured pressings (lib/disc-paint.ts paints the same recipe for the catalog).
const DISC_PARS = `
  uniform vec4 uCol[3];
  uniform int uCount;
  uniform int uMode;
  uniform float uSeed;
  uniform float uParts;
  uniform float uSpin;
  varying vec2 vP;
  ${LINES_GLSL}
  ${BUMP_GLSL}
  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int k = 0; k < 4; k++) {
      s += a * vnoise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return s;
  }
  // Scattered blobs of varied size on a unit grid. wrap > 0 repeats the grid
  // every wrap cells up, so a ring of blobs closes without a seam.
  float splat(vec2 g, float seed, float wrap) {
    vec2 i = floor(g);
    float m = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 c = i + vec2(float(x), float(y));
        vec2 k = wrap > 0.0 ? vec2(c.x, mod(c.y, wrap)) : c;
        float r = h21(k + seed);
        vec2 o = vec2(h21(k + seed + 1.3), h21(k + seed + 2.7));
        float rad = 0.1 + 0.34 * r * r;
        m = max(m, smoothstep(rad, rad * 0.78, length(g - (c + o))) * step(0.42, r));
      }
    }
    return m;
  }
  // Value noise that repeats every per cells across, so a pattern laid round
  // the disc in angle closes without a seam.
  float wnoise(vec2 p, float per) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float x0 = i.x - per * floor(i.x / per);
    float x1 = i.x + 1.0 - per * floor((i.x + 1.0) / per);
    return mix(mix(h21(vec2(x0, i.y)), h21(vec2(x1, i.y)), f.x), mix(h21(vec2(x0, i.y + 1.0)), h21(vec2(x1, i.y + 1.0)), f.x), f.y);
  }
  float wfbm(vec2 p, float per) {
    float a = 0.5;
    float s = 0.0;
    for (int k = 0; k < 4; k++) {
      s += a * wnoise(p, per);
      p = vec2(p.x * 2.0, p.y * 2.03 + 17.1);
      per *= 2.0;
      a *= 0.5;
    }
    return s;
  }
  // Colour-in-colour with a splatter (sunburst() in lib/disc-paint.ts): the
  // two colours in patches, streaks of the third out from the label.
  vec2 sunburst(float u, float r, float seed) {
    float w = u + 0.018 * (wfbm(vec2(u * 14.0, r * 0.8 + seed), 14.0) - 0.5);
    float blot = wfbm(vec2(w * 11.0, r * 0.5 + seed), 11.0)
      + 0.35 * (wfbm(vec2(w * 36.0, r * 0.16 + seed + 3.1), 36.0) - 0.5)
      + 0.25 * (wfbm(vec2(w * 110.0, r * 0.08 + seed + 5.3), 110.0) - 0.5)
      - 0.05 * smoothstep(3.0, 4.2, r) * smoothstep(5.6, 4.8, r);
    float reach = 3.2 + 3.4 * pow(wfbm(vec2(w * 60.0, seed + 9.4), 60.0), 1.3);
    float thin = smoothstep(2.3, reach, r);
    float streak = 0.75 * wfbm(vec2(w * 150.0, r * 0.07 + seed * 0.7), 150.0)
      + 0.25 * wfbm(vec2(w * 150.0, r * 1.1 + seed + 4.2), 150.0);
    float edge = 0.34 + 0.2 * thin;
    float ring = smoothstep(2.85, 2.25, r);
    return vec2(smoothstep(0.29, 0.48, blot), max(smoothstep(edge - 0.03, edge + 0.06, streak), ring * 0.92));
  }
  vec4 discPattern(vec2 P, float r) {
    float ang = atan(P.y, P.x);
    vec4 A = uCol[0];
    vec4 B = uCol[1];
    vec4 C = uCol[2];
    vec4 base = A;
    if (uMode == 1) {
      vec2 q = P * 0.3 + uSeed;
      float w = fbm(q + 1.7 * vec2(fbm(q + 3.1), fbm(q + 7.7)));
      base = mix(A, B, smoothstep(0.4, 0.6, w));
      if (uCount > 2) base = mix(base, C, smoothstep(0.56, 0.7, fbm(q * 1.6 + 9.0)));
    } else if (uMode == 2) {
      // 28 cells round the ring (4.456 a radian), so it meets itself.
      float m = max(splat(P * 0.95 + uSeed, 1.0, 0.0), splat(vec2(r * 1.25, ang * 4.456338) + uSeed, 5.0, 28.0));
      base = mix(A, B, m);
      if (uCount > 2) base = mix(base, C, splat(P * 1.3 - uSeed, 9.0, 0.0));
    } else if (uMode == 3) {
      // Split across the middle, so both halves show on the part that slides out.
      base = mix(B, A, smoothstep(-0.04, 0.04, P.y + P.x * 0.12));
    } else if (uMode == 4) {
      float wob = (fbm(vec2(cos(ang), sin(ang)) * 1.6 + uSeed) - 0.5) * 1.6;
      base = mix(B, A, smoothstep(3.75 + wob, 3.4 + wob, r));
    } else if (uMode == 5) {
      float band = (P.y / 5.85 * 0.5 + 0.5) * float(uCount);
      base = band < 1.0 ? A : (band < 2.0 ? B : C);
    } else if (uMode == 7) {
      vec2 sb = sunburst(ang / 6.28318 + 0.5, r, uSeed);
      base = mix(mix(A, B, sb.x), C, sb.y);
    } else if (uMode == 6) {
      // Pinwheel / quad pressings: wedges of alternating colour.
      float wedge = mod(floor((ang + 3.14159) / 6.28318 * uParts), float(uCount));
      base = wedge < 0.5 ? A : (wedge < 1.5 ? B : C);
    }
    return base;
  }
`;

const DISC_COLOR = `
  float dR = length(vP);
  // The pressing turns (uSpin); the light on it stays where it is.
  float dCs = cos(uSpin);
  float dSn = sin(uSpin);
  vec4 dBase = discPattern(vec2(dCs * vP.x - dSn * vP.y, dSn * vP.x + dCs * vP.y), dR);
  vec3 dCol = dBase.rgb;
  float dAlpha = dBase.a;
  float dPressed = step(2.35, dR) * step(dR, 5.6);
  float dGroove = lines(dR * 5.5, 0.11) * dPressed;
  // Smooth bands between the tracks, which catch the light differently.
  float dGap = 0.0;
  dGap = max(dGap, 1.0 - smoothstep(0.0, 0.028, abs(dR - 3.2)));
  dGap = max(dGap, 1.0 - smoothstep(0.0, 0.028, abs(dR - 3.95)));
  dGap = max(dGap, 1.0 - smoothstep(0.0, 0.028, abs(dR - 4.75)));
  dGap *= dPressed;
  float dLum = dot(dCol, vec3(0.3, 0.6, 0.1));
  dCol *= 1.0 - dGroove * 0.2 * smoothstep(0.003, 0.04, dLum);
  dAlpha = mix(dAlpha, 1.0, clamp(dGroove * 0.12, 0.0, 1.0) * dPressed);
  // A thin rim so a clear disc still has an edge.
  dAlpha = mix(dAlpha, 1.0, smoothstep(5.74, 5.82, dR) * 0.5);
  float dLabel = 1.0 - step(2.15, dR);
  if (dLabel > 0.5) {
    dCol = vec3(0.85, 0.77, 0.63);
    dCol = mix(dCol, vec3(0.46, 0.27, 0.065), lines(dR * 2.6 + 0.27, 0.05));
    dCol = mix(dCol, vec3(0.2, 0.03, 0.07), step(dR, 0.62) * 0.9);
    dAlpha = 1.0;
  }
  if (dR < 0.15) dCol = vec3(0.001);
  diffuseColor = vec4(dCol, dAlpha * opacity);
`;

const DISC_MODES: Record<string, number> = {
  solid: 0,
  marble: 1,
  splatter: 2,
  split: 3,
  inner: 4,
  stripes: 5,
  wedges: 6,
  sunburst: 7,
};
// A coloured pressing turns once it's out of the sleeve: one turn in about
// ten seconds, slow enough to read the pattern as it comes past.
const DISC_SPIN = (Math.PI * 2) / 10;
const BLACK_DISC: DiscStyle = { mode: "solid", colors: [{ hex: "#0c0d12", alpha: 1 }], label: "" };

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; dim: number };
type SleeveState = Pose & { op: number; slide: number; tag: number };

// The shop's fonts are next/font families with generated names; read them
// off the stage's CSS variables and make sure they're loaded before any
// lettering is drawn to a canvas.
function stageFonts(stage: HTMLElement) {
  const css = getComputedStyle(stage);
  return {
    heading: css.getPropertyValue("--font-heading").trim() || "Georgia, serif",
    caps: css.getPropertyValue("--font-caps").trim() || "Georgia, serif",
  };
}

export async function loadCrateFonts(stage: HTMLElement) {
  const fonts = stageFonts(stage);
  await Promise.all([
    document.fonts.load(`400 40px ${fonts.heading}`),
    document.fonts.load(`400 40px ${fonts.caps}`),
  ]).catch(() => {});
}

// Throws when WebGL isn't available; the caller falls back to the flat crate.
export function createCrateScene(
  stage: HTMLElement,
  { reduceMotion, onReady }: { reduceMotion: boolean; onReady?: () => void }
): CrateScene {
  const fonts = stageFonts(stage);
  const ease = (dt: number, rate: number) => (reduceMotion ? 1 : 1 - Math.exp(-dt * rate));
  const owned: { dispose(): void }[] = []; // everything to free on dispose()
  const own = <D extends { dispose(): void }>(d: D) => {
    owned.push(d);
    return d;
  };

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Khronos "PBR Neutral": tames the highlights but keeps album art its own colours.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  stage.appendChild(canvas);
  // Phones and small stages get a lighter shadow map.
  const small = Math.min(stage.clientWidth || 0, window.innerWidth) < 700;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAM.fov, 1, 1, 400);
  scene.add(camera);
  const look = { az: CAM.az, el: CAM.el, dAz: 0, dEl: 0 };

  // ── light ──

  // Soft image light from a plain room: what the wood sheen, the foil and the
  // vinyl reflect.
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = own(pmrem.fromScene(room, 0.04));
    room.dispose();
    pmrem.dispose();
    scene.environment = env.texture;
    scene.environmentIntensity = 0.55;
  }

  // Warm key light from the upper left, the only one that casts shadows.
  const key = new THREE.DirectionalLight(0xffe4bf, 3.5);
  key.position.set(-15, 30, 22);
  key.target.position.set(0, 7, -1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  const sc = key.shadow.camera;
  sc.left = -17;
  sc.right = 17;
  sc.top = 17;
  sc.bottom = -15;
  sc.near = 10;
  sc.far = 80;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.035;
  scene.add(key, key.target);
  // A low neutral fill from the right, and a warm rim from behind that
  // catches the tops of the sleeves and the rails.
  const fill = new THREE.DirectionalLight(0xc9b8a6, 0.35);
  fill.position.set(22, 9, 12);
  const rim = new THREE.DirectionalLight(0xffc483, 0.8);
  rim.position.set(14, 20, -26);
  scene.add(fill, rim);

  function canvasTexture(
    w: number,
    h: number,
    draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
    color = true
  ) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = maxAniso;
    if (color) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Canvas letter-spacing is newer than the rest of the 2D API.
  function spaced(g: CanvasRenderingContext2D, px: number) {
    if ("letterSpacing" in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
  }

  // ── the bin ──

  // A small botanical sprig: a curving stem with leaves along it.
  function sprig(g: CanvasRenderingContext2D, x: number, y: number, ang: number, size: number) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.lineWidth = size * 0.04;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(size * 0.5, -size * 0.14, size, -size * 0.04);
    g.stroke();
    for (let k = 0; k < 5; k++) {
      const t = 0.2 + k * 0.17;
      const px = size * t;
      const py = -size * 0.14 * 2 * t * (1 - t);
      for (const side of [1, -1]) {
        if (k === 4 && side < 0) continue;
        g.save();
        g.translate(px, py);
        g.rotate(side * (0.8 - t * 0.35) - 0.08);
        g.beginPath();
        g.ellipse(size * 0.085, 0, size * 0.09, size * 0.036, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
    g.beginPath();
    g.arc(size * 1.03, -size * 0.05, size * 0.035, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // The front board's tooling, drawn once: red = gold stamping, blue = blind
  // (uncoloured) pressing. The leather inset itself is worked out in the shader
  // from PANEL, so its edge stays crisp at any size.
  const PX = 100; // canvas pixels to the inch
  const FRONT_H = H_FRONT - RAIL; // the front board runs up into the rail
  const PANEL = { side: 0.62, top: 0.66, bottom: 0.34 }; // walnut frame, inches
  const plaque = own(
    canvasTexture(
      Math.round(W_IN * PX),
      Math.round(FRONT_H * PX),
      (g, w, h) => {
        g.fillStyle = "#000";
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = "lighter";
        const x0 = PANEL.side * PX;
        const y0 = PANEL.top * PX;
        const pw = w - x0 * 2;
        const ph = h - y0 - PANEL.bottom * PX;
        // Fine pressed border, with a whisper of gold left in it.
        g.strokeStyle = "rgb(70,0,255)";
        g.lineWidth = 3;
        g.beginPath();
        g.roundRect(x0 + 15, y0 + 15, pw - 30, ph - 30, 5);
        g.stroke();
        // Blind-tooled sprigs in the corners.
        g.fillStyle = "#00f";
        g.strokeStyle = "#00f";
        const sz = Math.min(130, ph * 0.42);
        sprig(g, x0 + 34, y0 + 32, 0.62, sz);
        sprig(g, x0 + 34, y0 + ph - 32, -0.62, sz);
        sprig(g, x0 + pw - 34, y0 + 32, Math.PI - 0.62, sz);
        sprig(g, x0 + pw - 34, y0 + ph - 32, Math.PI + 0.62, sz);
        // The name on one centred line, as large as fits between the sprigs.
        g.fillStyle = "#f00";
        g.textAlign = "center";
        g.textBaseline = "middle";
        const name = "Curiouser Records";
        let size = 118;
        for (; size > 40; size -= 2) {
          g.font = `400 ${size}px ${fonts.caps}`;
          spaced(g, size * 0.16);
          if (g.measureText(name).width <= pw * 0.7) break;
        }
        g.fillText(name, w / 2 + size * 0.08, y0 + ph / 2 + size * 0.05);
      },
      false
    )
  );
  const panelUv = new THREE.Vector4(
    PANEL.side / W_IN,
    PANEL.bottom / FRONT_H,
    1 - PANEL.side / W_IN,
    1 - PANEL.top / FRONT_H
  );

  const WOOD_VERTEX_PARS =
    "#include <common>\nvarying vec3 vLocal;\nvarying vec3 vLocalN;\nvarying vec3 vWorldP;\nvarying vec3 vWorldN;";
  const WOOD_VERTEX_MAIN =
    "#include <begin_vertex>\nvLocal = position;\nvLocalN = normal;\n" +
    "vWorldP = (modelMatrix * vec4(position, 1.0)).xyz;\nvWorldN = normalize(mat3(modelMatrix) * normal);";

  // One walnut material per board size (the edge wear needs the size); boards
  // of the same size and seed share one.
  const woodCache = new Map<string, THREE.MeshStandardMaterial>();
  function wood(
    w: number,
    h: number,
    d: number,
    axis: 0 | 1 | 2,
    seed: number,
    extra: { round?: boolean; plaque?: boolean } = {}
  ) {
    const k = [w, h, d, axis, seed, extra.round ? 1 : 0, extra.plaque ? 1 : 0].join("|");
    const cached = woodCache.get(k);
    if (cached) return cached;
    const uniforms = {
      uHalf: { value: new THREE.Vector3(w / 2, h / 2, d / 2) },
      uAxis: { value: axis },
      uSeed: { value: seed },
      uRound: { value: extra.round ? 1 : 0 },
      uPlaque: { value: plaque },
      uHasPlaque: { value: extra.plaque ? 1 : 0 },
      uPanel: { value: panelUv },
    };
    // Dimmer room reflections keep the dark finish from going grey.
    const m = own(new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, envMapIntensity: 0.45 }));
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", WOOD_VERTEX_PARS)
        .replace("#include <begin_vertex>", WOOD_VERTEX_MAIN);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${WOOD_PARS}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${WOOD_COLOR}`)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = wRough;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = wMetal;")
        .replace(
          "#include <normal_fragment_maps>",
          "#include <normal_fragment_maps>\nnormal = crateBump(-vViewPosition, normal, wHeight, 0.045, faceDirection);"
        )
        .replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${WOOD_OCCLUSION}`);
    };
    m.customProgramCacheKey = () => "crate-wood";
    woodCache.set(k, m);
    return m;
  }

  const bin = new THREE.Group();
  scene.add(bin);

  function board(geo: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(own(geo), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bin.add(mesh);
    return mesh;
  }
  function plank(w: number, h: number, d: number, axis: 0 | 1 | 2, seed: number, x: number, y: number, z: number, plaqueFace = false) {
    const r = Math.min(0.06, Math.min(w, h, d) * 0.2);
    return board(new RoundedBoxGeometry(w, h, d, 2, r), wood(w, h, d, axis, seed, { plaque: plaqueFace }), x, y, z);
  }

  // The rails sit on top of the walls, their inner faces flush with the
  // inside of the bin so the extra thickness grows outward (the sleeves keep
  // their clearance). The side rails slope from the front rail up to the back.
  const RAIL_X = W_IN / 2 + RAIL;
  const RAIL_ZF = Z_FRONT + RAIL;
  const RAIL_ZB = Z_BACK - WALL;
  // Height of the side walls' top edge (the side rails' centre line) at z.
  const sideTop = (z: number) =>
    H_FRONT - RAIL + ((H_BACK - H_FRONT) * (RAIL_ZF - z)) / (RAIL_ZF - RAIL_ZB);

  // No two boards share a visible face: the floor sits inside the walls, the
  // sides run between the end boards, and the corners are separate fingers.
  plank(W_IN, FLOOR, Z_FRONT - Z_BACK, 1, 3.1, 0, FLOOR / 2, Z_MID);
  plank(W_IN, FRONT_H, WALL, 0, 0.7, 0, FRONT_H / 2, Z_FRONT + WALL / 2, true);
  plank(W_IN, H_BACK, WALL, 0, 5.3, 0, H_BACK / 2, Z_BACK - WALL / 2);

  const SIDE_LEN = Z_FRONT - Z_BACK;
  const BEVEL = 0.04;
  const sideH = sideTop(Z_BACK);
  for (const sign of [1, -1]) {
    // Drawn with the front at -x (rotateY below turns -x into +z), centred on
    // the side's bounding box so the edge wear lines up.
    const hw = SIDE_LEN / 2 - BEVEL;
    const hb = sideH / 2 - BEVEL;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hb);
    shape.lineTo(hw, -hb);
    shape.lineTo(hw, hb);
    shape.lineTo(-hw, -sideH / 2 + sideTop(Z_FRONT) - BEVEL);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: WALL - BEVEL * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 2,
    });
    geo.translate(0, 0, -(WALL - BEVEL * 2) / 2);
    geo.rotateY(Math.PI / 2);
    board(geo, wood(WALL, sideH, SIDE_LEN, 1, sign > 0 ? 2.2 : 8.4), sign * (W_IN / 2 + WALL / 2), sideH / 2, Z_MID);
  }

  // Box-jointed corner posts: fingers alternate between the end board (grain
  // across) and the side board (end grain showing on the front).
  const CX = W_IN / 2 + WALL / 2;
  for (const sx of [1, -1]) {
    for (const [z, height] of [
      [Z_FRONT + WALL / 2, FRONT_H],
      [Z_BACK - WALL / 2, sideTop(Z_BACK - WALL / 2)],
    ]) {
      const count = Math.max(3, Math.round(height / FINGER));
      const finger = height / count;
      for (let k = 0; k < count; k++) {
        const fromEnd = k % 2 === 0;
        plank(
          WALL,
          finger,
          WALL,
          fromEnd ? 0 : 1,
          fromEnd ? (z > 0 ? 0.7 : 5.3) : sx > 0 ? 2.2 : 8.4,
          sx * CX,
          finger * (k + 0.5),
          z
        );
      }
    }
  }

  // A thick, softly rounded rail: a turned profile whose ends show end grain.
  function railGeometry(len: number) {
    const f = 0.08;
    const pts = [new THREE.Vector2(0, -len / 2)];
    for (let k = 0; k <= 5; k++) {
      const a = -Math.PI / 2 + (k / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(RAIL - f + Math.cos(a) * f, -len / 2 + f + Math.sin(a) * f));
    }
    for (let k = 0; k <= 5; k++) {
      const a = (k / 5) * (Math.PI / 2);
      pts.push(new THREE.Vector2(RAIL - f + Math.cos(a) * f, len / 2 - f + Math.sin(a) * f));
    }
    pts.push(new THREE.Vector2(0, len / 2));
    return new THREE.LatheGeometry(pts, 48);
  }
  const up = new THREE.Vector3(0, 1, 0);
  function rail(a: THREE.Vector3, b: THREE.Vector3, seed: number) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const mesh = board(railGeometry(len), wood(RAIL * 2, len, RAIL * 2, 2, seed, { round: true }), mid.x, mid.y, mid.z);
    mesh.quaternion.setFromUnitVectors(up, dir.normalize());
  }
  // The front rail spans the full width, its end grain capping the corners;
  // each side rail runs from inside it up to the back corner.
  rail(new THREE.Vector3(-(RAIL_X + RAIL), H_FRONT - RAIL, RAIL_ZF), new THREE.Vector3(RAIL_X + RAIL, H_FRONT - RAIL, RAIL_ZF), 1.7);
  for (const sx of [1, -1]) {
    rail(
      new THREE.Vector3(sx * RAIL_X, sideTop(RAIL_ZF - RAIL * 0.6), RAIL_ZF - RAIL * 0.6),
      new THREE.Vector3(sx * RAIL_X, sideTop(RAIL_ZB), RAIL_ZB),
      sx > 0 ? 4.4 : 9.3
    );
  }

  // Aged brass corner protectors round the two lower front corners, wrapping
  // onto the sides: a darker face with a burnished edge, a domed slotted screw.
  const brassFace = own(new THREE.MeshStandardMaterial({ color: 0x8a6a37, metalness: 1, roughness: 0.5 }));
  const brassEdge = own(new THREE.MeshStandardMaterial({ color: 0xd4ad66, metalness: 1, roughness: 0.26 }));
  const CAP = 1.15;
  const capShape = new THREE.Shape();
  capShape.moveTo(0, 0);
  capShape.lineTo(CAP, 0);
  capShape.quadraticCurveTo(CAP * 0.9, CAP * 0.9, 0, CAP);
  capShape.closePath();
  const capGeo = own(
    new THREE.ExtrudeGeometry(capShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.03,
      bevelSegments: 3,
      curveSegments: 16,
    })
  );
  const SCREW_R = 0.12;
  const screwGeo = own(new THREE.SphereGeometry(SCREW_R, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  screwGeo.rotateX(Math.PI / 2);
  screwGeo.scale(1, 1, 0.5);
  {
    // Flat-on texture coordinates, so the slot runs straight across the dome.
    const pos = screwGeo.attributes.position;
    const uv = screwGeo.attributes.uv;
    for (let k = 0; k < pos.count; k++) {
      uv.setXY(k, pos.getX(k) / (SCREW_R * 2) + 0.5, pos.getY(k) / (SCREW_R * 2) + 0.5);
    }
  }
  const screwMat = own(
    new THREE.MeshStandardMaterial({
      metalness: 1,
      roughness: 0.36,
      map: own(
        canvasTexture(64, 64, (g, w, h) => {
          const grad = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
          grad.addColorStop(0, "#d6b06a");
          grad.addColorStop(1, "#7e5f2e");
          g.fillStyle = grad;
          g.fillRect(0, 0, w, h);
          g.fillStyle = "#22170a";
          g.fillRect(6, h / 2 - 4, w - 12, 8);
        })
      ),
    })
  );
  const OUT = OUTER_W / 2;
  const ZO = Z_FRONT + WALL;
  for (const sx of [1, -1]) {
    // [rotation about y, mirror] for the plate on the front face, then the side.
    const plates: [number, number][] = [
      [0, sx > 0 ? -1 : 1],
      [sx > 0 ? Math.PI / 2 : -Math.PI / 2, sx > 0 ? 1 : -1],
    ];
    for (const [ry, flip] of plates) {
      const cap = new THREE.Mesh(capGeo, [brassFace, brassEdge]);
      cap.position.set(sx * OUT, 0.01, ZO);
      cap.rotation.y = ry;
      cap.scale.x = flip;
      cap.castShadow = true;
      cap.receiveShadow = true;
      const screw = new THREE.Mesh(screwGeo, screwMat);
      screw.position.set(CAP * 0.3, CAP * 0.3, 0.05);
      screw.rotation.z = hash(sx + ry, 7) * Math.PI;
      cap.add(screw);
      bin.add(cap);
    }
  }

  // The ground: a pool of shadow and faint hatching that fades into the plate.
  const ground = new THREE.Mesh(
    own(new THREE.PlaneGeometry(160, 160)),
    own(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uBase: { value: raw(0x120c11) },
          uLine: { value: raw(0x4b3b45) },
        },
        vertexShader: WORLD_VERTEX,
        fragmentShader: `
          uniform vec3 uBase;
          uniform vec3 uLine;
          varying vec3 vW;
          ${LINES_GLSL}
          void main() {
            vec2 c = vW.xz - vec2(0.0, ${Z_MID.toFixed(2)});
            float fade = 1.0 - smoothstep(9.0, 30.0, length(c));
            vec2 q = abs(c) - vec2(${(OUTER_W / 2).toFixed(2)}, ${(DEPTH / 2).toFixed(2)});
            float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
            float shadow = 1.0 - smoothstep(-0.5, 6.0, sd);
            float l1 = lines((vW.x * 0.8 + vW.z * 0.6) * 1.4, 0.07);
            float l2 = lines((vW.x * 0.6 - vW.z * 0.8) * 1.4, 0.05) * 0.6;
            vec3 col = mix(uBase, uLine, max(l1, l2) * 0.45 * (1.0 - shadow * 0.9));
            float contact = 1.0 - smoothstep(0.0, 1.4, sd);
            col *= (1.0 - shadow * 0.6) * (1.0 - contact * 0.6);
            gl_FragColor = vec4(col, fade * mix(0.45, 0.98, max(shadow, contact)));
          }
        `,
      })
    )
  );
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -2;
  scene.add(ground);
  // The key light's shadow of the crate and the lifted record, on that ground.
  const catcher = new THREE.Mesh(
    own(new THREE.PlaneGeometry(70, 70)),
    own(new THREE.ShadowMaterial({ color: 0x07050a, opacity: 0.6, depthWrite: false }))
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.renderOrder = -1;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // ── stars, fixed to the camera so they sit in the plate's sky ──

  const STAR_Z = 90;
  const starCount = 64;
  const starPos = new Float32Array(starCount * 3);
  const starSize = new Float32Array(starCount);
  const starPhase = new Float32Array(starCount);
  const halfH = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * STAR_Z;
  for (let k = 0; k < starCount; k++) {
    const up = Math.pow(hash(k, 1), 0.7);
    starPos[k * 3] = (hash(k, 2) - 0.5) * halfH * 2.6;
    starPos[k * 3 + 1] = halfH * (0.99 - up * 0.62);
    starPos[k * 3 + 2] = -STAR_Z;
    starSize[k] = hash(k, 3) > 0.84 ? 15 + hash(k, 4) * 9 : 4 + hash(k, 4) * 6;
    starPhase[k] = hash(k, 5) * 6.283;
  }
  const starGeo = own(new THREE.BufferGeometry());
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute("aSize", new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute("aPhase", new THREE.BufferAttribute(starPhase, 1));
  const starMat = own(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uDpr: { value: dpr },
        uColor: { value: raw(0xf0dcae) },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uDpr;
        varying float vTwinkle;
        void main() {
          vTwinkle = 0.62 + 0.38 * sin(uTime * (0.6 + fract(aPhase) * 0.9) + aPhase);
          // The sprite keeps one size (a changing one snaps to whole pixels and
          // buzzes); the star swells and shrinks inside it.
          gl_PointSize = aSize * uDpr * 1.15;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vTwinkle;
        void main() {
          vec2 p = (gl_PointCoord * 2.0 - 1.0) * 1.15 / (0.85 + 0.3 * vTwinkle);
          float d = length(p);
          float core = smoothstep(0.24, 0.0, d);
          float rays = (1.0 - smoothstep(0.0, 1.0, d)) * 0.014 / (abs(p.x * p.y) + 0.014);
          gl_FragColor = vec4(uColor, clamp(core + rays, 0.0, 1.0) * vTwinkle);
        }
      `,
    })
  );
  const starPoints = new THREE.Points(starGeo, starMat);
  starPoints.frustumCulled = false;
  starPoints.renderOrder = -3;
  camera.add(starPoints);

  // ── sleeves ──

  const sleeveGeo = own(new THREE.BoxGeometry(H, H, T));
  sleeveGeo.translate(0, H / 2, 0); // pivot on the bottom edge
  const discGeo = own(new THREE.CircleGeometry(5.85, 128));
  const tabGeo = own(new THREE.BoxGeometry(1.9, 1.0, 0.03));
  // The price tag curls a little off the sleeve.
  const stickerGeo = own(new THREE.PlaneGeometry(3.5, 2.2, 10, 1));
  {
    const pos = stickerGeo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const u = pos.getX(k) / 1.75;
      pos.setZ(k, 0.05 * u * u + 0.02 * u);
    }
    stickerGeo.computeVertexNormals();
  }

  const backTexture = own(
    canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = "#e4d9c2";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(23,29,48,0.07)";
      g.lineWidth = 1;
      for (let x = -h; x < w; x += 7) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + h, 0);
        g.stroke();
      }
      g.strokeStyle = "rgba(153,118,61,0.55)";
      g.lineWidth = 2;
      g.strokeRect(14, 14, w - 28, h - 28);
    })
  );

  const blankTexture = own(
    canvasTexture(4, 4, (g, w, h) => {
      g.fillStyle = BLANK;
      g.fillRect(0, 0, w, h);
    })
  );

  // One material per distinct disc; plain black is shared by every sleeve.
  // Lit vinyl: a clear-coated surface whose highlight stretches out from the
  // centre the way light runs across real grooves (anisotropy pointed along
  // the radius), smoother bands between tracks, a matte paper label.
  const DISC_LIGHTS = THREE.ShaderChunk.lights_physical_fragment
    .replace(
      "vec2 anisotropyV = anisotropyVector;",
      "vec2 anisotropyV = (dR > 0.01 ? vP / dR : vec2(1.0, 0.0)) * length(anisotropyVector) * dPressed * (1.0 - dGap * 0.7);"
    )
    .replace("material.clearcoat = clearcoat;", "material.clearcoat = clearcoat * (1.0 - dLabel);");
  const discMaterials = new Map<string, THREE.MeshPhysicalMaterial>();
  function discMaterialFor(item: CrateItem) {
    const style = item.disc && item.disc.mode !== "picture" ? item.disc : BLACK_DISC;
    const key =
      style === BLACK_DISC
        ? "black"
        : `${item.id}|${style.mode}|${style.colors.map((c) => c.hex + c.alpha).join("|")}`;
    const cached = discMaterials.get(key);
    if (cached) return cached;
    const cols = [0, 1, 2].map((k) => {
      const c = style.colors[Math.min(k, style.colors.length - 1)];
      const rgb = new THREE.Color(c.hex);
      return new THREE.Vector4(rgb.r, rgb.g, rgb.b, c.alpha);
    });
    const uniforms = {
      uCol: { value: cols },
      uCount: { value: style.colors.length },
      uMode: { value: DISC_MODES[style.mode] ?? 0 },
      uParts: { value: style.parts ?? 8 },
      uSeed: { value: discSeed(item.id) },
      uSpin: { value: 0 },
    };
    const material = own(
      new THREE.MeshPhysicalMaterial({
        side: THREE.DoubleSide,
        transparent: style.colors.some((c) => c.alpha < 1),
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.45,
        clearcoatRoughness: 0.14,
        anisotropy: 1,
        envMapIntensity: 2,
      })
    );
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vP;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvP = position.xy;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${DISC_PARS}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${DISC_COLOR}`)
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor = dLabel > 0.5 ? 0.6 : mix(mix(0.34, 0.14, dGap), 0.18, 1.0 - dPressed);"
        )
        .replace(
          "#include <normal_fragment_maps>",
          "#include <normal_fragment_maps>\nnormal = crateBump(-vViewPosition, normal, (dGroove - dGap) * dPressed, 0.03, faceDirection);"
        )
        .replace("#include <lights_physical_fragment>", DISC_LIGHTS);
    };
    material.customProgramCacheKey = () => "crate-disc";
    material.userData.spin = uniforms.uSpin;
    discMaterials.set(key, material);
    return material;
  }

  function placeholderTexture(item: CrateItem) {
    const [bg, fg] = TINTS[Math.floor(hash(item.id, 9) * TINTS.length)];
    return canvasTexture(256, 256, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `400 104px ${fonts.heading}`;
      g.fillText(item.initials, w / 2, h / 2 + 6);
    });
  }

  const tabTextures = new Map<string, THREE.Texture>();
  function tabTexture(letter: string) {
    let tex = tabTextures.get(letter);
    if (!tex) {
      tex = own(
        canvasTexture(152, 80, (g, w, h) => {
          g.fillStyle = "#efe1c3";
          g.fillRect(0, 0, w, h);
          g.strokeStyle = "rgba(37,27,51,0.45)";
          g.lineWidth = 4;
          g.strokeRect(2, 2, w - 4, h + 8);
          g.fillStyle = "#582236";
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.font = `400 58px ${fonts.caps}`;
          g.fillText(letter, w / 2, h / 2 + 3);
        })
      );
      tabTextures.set(letter, tex);
    }
    return tex;
  }

  function stickerTexture(lines: string[]) {
    return canvasTexture(350, 220, (g, w, h) => {
      g.fillStyle = "#e0c796";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#99763d";
      g.lineWidth = 6;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.fillStyle = "#372a16";
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      if (lines.length < 2) {
        g.font = `400 96px ${fonts.caps}`;
        g.fillText(lines[0] ?? "", w / 2, 142);
        return;
      }
      g.font = `400 112px ${fonts.heading}`;
      g.fillText(lines[0], w / 2, 122);
      g.font = `400 50px ${fonts.caps}`;
      spaced(g, 3);
      g.fillText(lines[1], w / 2, 186);
    });
  }

  // Cover textures outlive their sleeve for a while, so filtering or
  // flipping back doesn't reload them.
  const textureLoader = new THREE.TextureLoader();
  type CoverWait = { onLoad: (t: THREE.Texture) => void; onFail: () => void };
  type CoverEntry = { tex: THREE.Texture | null; refs: number; waiting: CoverWait[] };
  const covers = new Map<string, CoverEntry>();
  function loadCover(url: string) {
    const entry: CoverEntry = { tex: null, refs: 0, waiting: [] };
    covers.set(url, entry);
    const ready = (tex: THREE.Texture) => {
      if (disposed || covers.get(url) !== entry) {
        tex.dispose();
        return;
      }
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      // Send it to the GPU now, not in the middle of the flip that first shows it.
      renderer.initTexture(tex);
      entry.tex = tex;
      for (const w of entry.waiting.splice(0)) w.onLoad(tex);
    };
    textureLoader.load(
      url,
      (tex) => {
        // Decode off the main thread first, so the upload doesn't stall a frame.
        const image = tex.image as HTMLImageElement;
        if (typeof image.decode === "function") {
          image.decode().then(
            () => ready(tex),
            () => ready(tex)
          );
        } else {
          ready(tex);
        }
      },
      undefined,
      () => {
        if (covers.get(url) === entry) covers.delete(url);
        for (const w of entry.waiting.splice(0)) w.onFail(); // those sleeves show initials
      }
    );
    return entry;
  }
  // Fetch a cover nobody is showing yet.
  function warmCover(url: string) {
    if (!covers.has(url)) loadCover(url);
  }
  // True when the cover was already here (onLoad has run); false = it's on its way.
  function takeCover(url: string, wait: CoverWait) {
    let entry = covers.get(url);
    if (entry) {
      covers.delete(url); // re-insert: most recently used last
      covers.set(url, entry);
    } else {
      entry = loadCover(url);
    }
    entry.refs++;
    if (entry.tex) {
      wait.onLoad(entry.tex);
      return true;
    }
    entry.waiting.push(wait);
    return false;
  }
  function releaseCover(url: string) {
    const entry = covers.get(url);
    if (entry) entry.refs--;
    if (covers.size <= COVER_CACHE_MAX) return;
    for (const [key, e] of covers) {
      if (covers.size <= COVER_CACHE_MAX) break;
      if (e.refs <= 0 && e.tex) {
        e.tex.dispose();
        covers.delete(key);
      }
    }
  }

  let items: CrateItem[] = [];
  let signature = "";
  let positions = new Map<number, number>(); // record id -> position in items
  let index = 0;
  let hovered = -1;
  let disposed = false;
  const sleeves = new Map<number, Sleeve>(); // by record id
  const leaving: Sleeve[] = [];
  const stack = new THREE.Group();
  scene.add(stack);

  function poseFor(i: number): Pose {
    const d = i - index;
    if (d === 0) return { x: HELD.x, y: HELD.y, z: HELD.z, rx: HELD.rx, ry: HELD.ry, rz: 0, dim: 1 };
    const id = items[i].id;
    const x = (hash(id, 1) - 0.5) * 0.3;
    const rz = (hash(id, 2) - 0.5) * 0.022;
    if (d > 0) {
      const standing = Math.min(items.length - 1 - index, BEHIND);
      return {
        x,
        y: FLOOR + (hovered === i ? 0.9 : 0),
        z: Z_B_REST + (standing - d) * GAP,
        rx: -LEAN_B,
        ry: 0,
        rz,
        dim: Math.max(0.3, 0.9 - (d - 1) * 0.042),
      };
    }
    const k = -d;
    const flipped = Math.min(index, FLIPPED);
    return {
      x,
      y: FLOOR,
      z: Z_F_REST - (flipped - k) * GAP,
      rx: LEAN_F,
      ry: 0,
      rz,
      dim: Math.max(0.36, 0.62 - (k - 1) * 0.05),
    };
  }

  class Sleeve {
    item: CrateItem;
    mesh: THREE.Mesh;
    p: SleeveState;
    leaving = false;
    exit: Pose | null = null;
    private front: THREE.MeshStandardMaterial;
    private back: THREE.MeshStandardMaterial;
    private edge: THREE.MeshStandardMaterial;
    private tabMat: THREE.MeshStandardMaterial | null = null;
    private stickerMat: THREE.MeshStandardMaterial | null = null;
    private mats: THREE.MeshStandardMaterial[];
    private disc: THREE.Mesh;
    private showDisc: boolean;
    // Set for a coloured disc: the angle it has turned to.
    private spin: { value: number } | null = null;
    private placeholder: THREE.Texture | null = null;
    // 0 → 1 as a cover that arrived late comes up out of the dark.
    private lit = 1;
    private clear = false;
    private gone = false;

    constructor(item: CrateItem, pose: Pose) {
      this.item = item;
      this.front = new THREE.MeshStandardMaterial({ map: blankTexture, roughness: 0.6, envMapIntensity: 0.35 });
      this.back = new THREE.MeshStandardMaterial({ map: backTexture, roughness: 0.8 });
      this.edge = new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.9 });
      this.mats = [this.front, this.back, this.edge];
      this.mesh = new THREE.Mesh(sleeveGeo, [
        this.edge,
        this.edge,
        this.edge,
        this.edge,
        this.front,
        this.back,
      ]);
      this.mesh.rotation.order = "YXZ";
      this.mesh.userData.sleeve = this;
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;

      const discMat = discMaterialFor(item);
      this.disc = new THREE.Mesh(discGeo, discMat);
      this.disc.castShadow = true;
      this.disc.receiveShadow = true;
      this.disc.position.set(0, H / 2, 0);
      this.disc.visible = false;
      this.mesh.add(this.disc);
      // A picture disc can't be drawn from a description: it stays in the sleeve.
      this.showDisc = item.disc?.mode !== "picture";
      // Black looks the same at any angle, so only colour turns.
      if (item.disc && this.showDisc && !reduceMotion) this.spin = discMat.userData.spin as { value: number };

      if (item.tab) {
        this.tabMat = new THREE.MeshStandardMaterial({
          map: tabTexture(item.tab),
          side: THREE.DoubleSide,
        });
        this.mats.push(this.tabMat);
        const tab = new THREE.Mesh(tabGeo, this.tabMat);
        tab.castShadow = true;
        tab.position.set(-H / 2 + 1.3 + ((item.tab.charCodeAt(0) * 7) % 5) * 2.3, H + 0.44, 0);
        this.mesh.add(tab);
      }

      if (item.cover) {
        let late = false;
        late = !takeCover(item.cover, {
          onLoad: (tex) => {
            if (this.gone) return;
            this.front.map = tex;
            this.lit = late ? 0 : 1; // already here: no fade
          },
          onFail: () => {
            if (!this.gone) this.initials();
          },
        });
      } else {
        this.initials();
      }

      this.p = { ...pose, op: 0, slide: 0, tag: 0 };
    }

    // No cover to show: the artist's initials on a tinted sleeve.
    private initials() {
      this.placeholder = placeholderTexture(this.item);
      this.front.map = this.placeholder;
      this.lit = 1;
    }

    private sticker() {
      if (this.stickerMat) return;
      this.stickerMat = new THREE.MeshStandardMaterial({
        map: stickerTexture(this.item.sticker),
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(stickerGeo, this.stickerMat);
      mesh.position.set(H / 2 - 1.9, H - 1.7, T / 2 + 0.03);
      mesh.rotation.z = -0.07;
      this.mesh.add(mesh);
    }

    update(dt: number, now: number) {
      const at = this.leaving ? -1 : (positions.get(this.item.id) ?? -1);
      const held = at === index && !this.leaving;
      const tgt = this.leaving || at === -1 ? (this.exit ?? this.p) : poseFor(at);
      const p = this.p;
      const a = ease(dt, held ? 6.5 : 9);
      const b = ease(dt, held ? 9 : 7.5);
      // The lifted record turns to face you once it's clear of its neighbours,
      // so its corners don't sweep through them on the way up.
      const lift = held ? THREE.MathUtils.smoothstep((p.y - FLOOR) / (HELD.y - FLOOR), 0.2, 0.75) : 1;
      p.x += (tgt.x - p.x) * a;
      p.z += (tgt.z - p.z) * a;
      p.rx += (tgt.rx - p.rx) * a;
      p.ry += (tgt.ry * lift - p.ry) * ease(dt, held ? 8 : 12);
      p.rz += (tgt.rz - p.rz) * a;
      p.y += (tgt.y - p.y) * b;
      p.dim += (tgt.dim - p.dim) * ease(dt, 8);
      p.op += ((this.leaving ? 0 : 1) - p.op) * ease(dt, 10);

      const settled = held && Math.abs(tgt.y - p.y) < 0.5;
      p.slide += ((settled && this.showDisc ? 1 : 0) - p.slide) * ease(dt, settled ? 3.5 : 14);
      p.tag += ((settled ? 1 : 0) - p.tag) * ease(dt, settled ? 7 : 16);
      if (held) this.sticker();

      let y = p.y;
      let rz = p.rz;
      if (held && !reduceMotion) {
        y += Math.sin(now * 1.2) * 0.09 * p.tag;
        rz += Math.sin(now * 0.8) * 0.006 * p.tag;
      }
      this.mesh.position.set(p.x, y, p.z);
      this.mesh.rotation.set(p.rx, p.ry, rz);

      this.lit += (1 - this.lit) * ease(dt, 6);
      // A sold record's cover is shown, but faded.
      const dim = p.dim * (this.item.sold ? 0.6 : 1) * (0.3 + 0.7 * this.lit);
      this.front.color.setScalar(dim);
      this.back.color.setScalar(p.dim);
      this.edge.color.copy(PAPER).multiplyScalar(p.dim);
      if (this.tabMat) this.tabMat.color.setScalar(Math.min(1, p.dim + 0.08));

      const clear = p.op < 0.995;
      if (clear !== this.clear) {
        this.clear = clear;
        for (const m of this.mats) {
          m.transparent = clear;
          m.needsUpdate = true;
        }
      }
      for (const m of this.mats) m.opacity = clear ? p.op : 1;

      this.disc.visible = p.slide > 0.01;
      this.disc.position.x = p.slide * 4.2;
      // It gets going as it slides out and runs down as it goes back in.
      if (this.spin && this.disc.visible) {
        this.spin.value = (this.spin.value + dt * DISC_SPIN * p.slide) % (Math.PI * 2);
      }
      if (this.stickerMat) this.stickerMat.opacity = p.tag * p.op;
    }

    dispose() {
      this.gone = true;
      stack.remove(this.mesh);
      if (this.item.cover) releaseCover(this.item.cover);
      this.placeholder?.dispose();
      this.stickerMat?.map?.dispose();
      this.stickerMat?.dispose();
      for (const m of this.mats) m.dispose();
    }
  }

  // Keep sleeves mounted only for the stretch of the crate you can see.
  function sync(jump: boolean, tumble: boolean) {
    const last = items.length - 1;
    const from = Math.max(0, index - FLIPPED);
    const to = Math.min(last, index + BEHIND);
    const keep = new Set<number>();
    for (let i = from; i <= to; i++) keep.add(items[i].id);

    for (const [id, s] of sleeves) {
      if (keep.has(id)) continue;
      sleeves.delete(id);
      if (jump) {
        s.dispose();
      } else {
        s.leaving = true;
        s.exit = { ...s.p, rx: s.p.rx + (s.p.rx > 0 ? 0.12 : 0), dim: 0.2 };
        leaving.push(s);
      }
    }
    for (let i = from; i <= to; i++) {
      const item = items[i];
      if (sleeves.has(item.id)) continue;
      const s = new Sleeve(item, poseFor(i));
      if (jump && i === index && !reduceMotion) {
        if (tumble) {
          s.p.y += 22;
          s.p.rx = -1.1;
          s.p.rz = -0.45;
          s.p.op = 1;
        } else {
          s.p.y += 5; // settles in from just above
        }
      } else if (jump) {
        s.p.op = 1;
      }
      sleeves.set(item.id, s);
      stack.add(s.mesh);
    }
    for (let i = Math.max(0, from - WARM_BACK); i <= Math.min(last, to + WARM_AHEAD); i++) {
      const cover = items[i].cover;
      if (cover && (i < from || i > to)) warmCover(cover);
    }
  }

  // ── pointer: hover lifts a record further back; the view leans a little ──

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function pick(clientX: number, clientY: number) {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return -1;
    pointer.set(
      ((clientX - box.left) / box.width) * 2 - 1,
      -((clientY - box.top) / box.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const meshes: THREE.Object3D[] = [];
    for (const s of sleeves.values()) meshes.push(s.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return -1;
    const sleeve = hit.object.userData.sleeve as Sleeve;
    return positions.get(sleeve.item.id) ?? -1;
  }

  function onMove(e: PointerEvent) {
    if (e.pointerType !== "mouse") return;
    const i = pick(e.clientX, e.clientY);
    hovered = i > index ? i : -1;
    stage.style.cursor = i === -1 ? "grab" : "pointer";
    if (reduceMotion) return;
    look.dAz = pointer.x * 0.07;
    look.dEl = pointer.y * 0.035;
  }
  function onLeave() {
    hovered = -1;
    look.dAz = 0;
    look.dEl = 0;
  }
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerleave", onLeave);

  // ── run ──

  function aim() {
    // A narrow stage pulls the camera back so the whole bin stays in frame.
    const dist = CAM.dist * Math.max(1, 0.94 / camera.aspect);
    camera.position.set(
      CAM.target.x + dist * Math.cos(look.el) * Math.sin(look.az),
      CAM.target.y + dist * Math.sin(look.el),
      CAM.target.z + dist * Math.cos(look.el) * Math.cos(look.az)
    );
    camera.lookAt(CAM.target);
  }

  let painted = false;
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Resizing wipes the canvas: draw again now, not a blank frame later.
    if (painted) {
      aim();
      renderer.render(scene, camera);
    }
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  let onScreen = true;
  const viewObserver = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
  });
  viewObserver.observe(stage);

  let before = performance.now();
  let raf = 0;
  // The wallpaper behind the bin drifts with the same eased lean as the camera.
  let driftX = 0;
  let driftY = 0;
  function frame(nowMs: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, (nowMs - before) / 1000);
    before = nowMs;
    if (!onScreen || !items.length) return;
    const now = nowMs / 1000;

    look.az += (CAM.az + look.dAz - look.az) * ease(dt, 4);
    look.el += (CAM.el + look.dEl - look.el) * ease(dt, 4);
    aim();
    const dx = (CAM.az - look.az) * 100;
    const dy = (look.el - CAM.el) * 114;
    if (Math.abs(dx - driftX) > 0.05 || Math.abs(dy - driftY) > 0.05) {
      driftX = dx;
      driftY = dy;
      stage.style.setProperty("--crate-px", `${dx.toFixed(1)}px`);
      stage.style.setProperty("--crate-py", `${dy.toFixed(1)}px`);
    }

    for (const s of sleeves.values()) s.update(dt, now);
    for (let k = leaving.length - 1; k >= 0; k--) {
      const s = leaving[k];
      s.update(dt, now);
      if (s.p.op < 0.02) {
        s.dispose();
        leaving.splice(k, 1);
      }
    }
    if (!reduceMotion) starMat.uniforms.uTime.value = now;
    renderer.render(scene, camera);
    if (!painted) {
      painted = true;
      onReady?.();
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    update(nextItems, nextIndex, fall = false) {
      if (disposed) return;
      const first = items.length === 0;
      // Compare by content: the list is rebuilt on every render upstream.
      const nextSignature = nextItems.map((it) => `${it.id}${it.tab ?? ""}`).join(",");
      const listChanged = nextSignature !== signature;
      const clamped = Math.min(Math.max(0, nextItems.length - 1), Math.max(0, nextIndex));
      const far = Math.abs(clamped - index) > 3;
      items = nextItems;
      index = clamped;
      hovered = -1;
      if (listChanged) {
        signature = nextSignature;
        positions = new Map(items.map((it, i) => [it.id, i]));
        // A new filter or sort: restock the bin rather than animate the shuffle.
        for (const s of sleeves.values()) s.dispose();
        sleeves.clear();
      }
      if (!items.length) return;
      sync(fall || listChanged || far, fall || first);
    },
    pick,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      viewObserver.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.style.cursor = "";
      stage.style.removeProperty("--crate-px");
      stage.style.removeProperty("--crate-py");
      for (const s of sleeves.values()) s.dispose();
      for (const s of leaving) s.dispose();
      sleeves.clear();
      leaving.length = 0;
      for (const e of covers.values()) e.tex?.dispose();
      covers.clear();
      for (const d of owned) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
