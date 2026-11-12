// Draws the shop's chinoiserie wallpaper tile and writes it in two
// colourways:
//
//   public/images/chinoiserie-day.svg    for parchment grounds (the hero)
//   public/images/chinoiserie-night.svg  for ink-purple grounds (the footer)
//
// Run with `node scripts/chinoiserie-tile.mjs`. The output is committed, so
// this only needs re-running when the drawing changes.
//
// The tile is a climbing vine in the chinoiserie manner (branches, leaves,
// blossom, perched birds) with the shop's own motifs worked in: records for
// fruit, the White Rabbit, his pocket watch, toadstools, a Cheshire grin.
// Everything is drawn once and stamped nine times at tile offsets, so any
// shape that runs off one edge comes back in on the opposite one and the
// repeat is seamless by construction.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIZE = 800;

const PALETTES = {
  day: {
    ink: "#4d3a5e",
    branch: "#a98a58",
    branchShade: "#8a6d3f",
    leafA: "#b3c2a2",
    leafB: "#8fa888",
    leafDark: "#6f8f76",
    petalA: "#eeb2ca",
    petalB: "#f8dfe9",
    core: "#c98a2b",
    record: "#2b1d40",
    recordEdge: "#4d3a5e",
    groove: "#8f7fa8",
    label: "#a83d68",
    cream: "#fffaf0",
    gold: "#c98a2b",
    goldLight: "#eecd8d",
    rasp: "#bb5583",
    pink: "#dd85a8",
  },
  night: {
    ink: "#150d24",
    branch: "#b08a45",
    branchShade: "#8a6a30",
    leafA: "#6f9080",
    leafB: "#52756a",
    leafDark: "#3f5f58",
    petalA: "#dd85a8",
    petalB: "#eeb2ca",
    core: "#eecd8d",
    record: "#150d24",
    recordEdge: "#a8823c",
    groove: "#c98a2b",
    label: "#c98a2b",
    cream: "#f3ecdd",
    gold: "#c98a2b",
    goldLight: "#eecd8d",
    rasp: "#bb5583",
    pink: "#dd85a8",
  },
};

// — small maths —

function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (v) => String(Math.round(v * 10) / 10);
const deg = (rad) => (rad * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;

/** Point and heading on one cubic segment [p0, c1, c2, p3]. */
function onSegment([p0, c1, c2, p3], t) {
  const u = 1 - t;
  const x = u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0];
  const y = u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1];
  const dx = 3 * u * u * (c1[0] - p0[0]) + 6 * u * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]);
  const dy = 3 * u * u * (c1[1] - p0[1]) + 6 * u * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1]);
  return { x, y, a: Math.atan2(dy, dx) };
}

/** Evenly spaced points (by parameter) along a chain of segments. */
function trace(segs, perSeg = 18) {
  const pts = [];
  segs.forEach((seg, i) => {
    for (let k = i === 0 ? 0 : 1; k <= perSeg; k++) pts.push(onSegment(seg, k / perSeg));
  });
  let len = 0;
  pts.forEach((p, i) => {
    if (i > 0) len += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
    p.d = len;
  });
  return pts;
}

/** Point at a fraction (0..1) of a traced path's length. */
function along(pts, frac) {
  const target = frac * pts[pts.length - 1].d;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d >= target) {
      const a = pts[i - 1];
      const b = pts[i];
      const k = (target - a.d) / (b.d - a.d || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: b.a };
    }
  }
  return pts[pts.length - 1];
}

/** A branch as a filled ribbon that tapers from w0 to w1. */
function ribbon(pts, w0, w1) {
  const total = pts[pts.length - 1].d;
  const left = [];
  const right = [];
  for (const p of pts) {
    const w = (w0 + (w1 - w0) * (p.d / total)) / 2;
    const nx = Math.cos(p.a + Math.PI / 2);
    const ny = Math.sin(p.a + Math.PI / 2);
    left.push(`${n(p.x + nx * w)} ${n(p.y + ny * w)}`);
    right.push(`${n(p.x - nx * w)} ${n(p.y - ny * w)}`);
  }
  return `M${left.join("L")}L${right.reverse().join("L")}Z`;
}

// — the drawing —

function build(c) {
  const rand = seeded(7);
  const between = (lo, hi) => lo + (hi - lo) * rand();
  const stamp = (id, x, y, rot = 0, scale = 1) =>
    `<use xlink:href="#${id}" transform="translate(${n(x)} ${n(y)}) rotate(${n(rot)}) scale(${n(scale)})"/>`;

  const stroke = `stroke="${c.ink}" stroke-linejoin="round" stroke-linecap="round"`;

  const petals = (fill) =>
    [0, 1, 2, 3, 4]
      .map((k) => {
        const a = rad(k * 72 - 90);
        return `<circle cx="${n(Math.cos(a) * 8)}" cy="${n(Math.sin(a) * 8)}" r="6.8" fill="${fill}" ${stroke} stroke-width="1.1"/>`;
      })
      .join("");

  const ticks = Array.from({ length: 12 }, (_, k) => {
    const a = rad(k * 30);
    return `M${n(Math.cos(a) * 12)} ${n(Math.sin(a) * 12)}L${n(Math.cos(a) * 14.4)} ${n(Math.sin(a) * 14.4)}`;
  }).join("");

  const defs = `
<g id="lfa"><path d="M0 0C7-9 24-10 36 0 24 10 7 9 0 0Z" fill="${c.leafA}" ${stroke} stroke-width="1.3"/><path d="M0 0C7-9 24-10 36 0Z" fill="${c.leafB}" opacity=".6"/><path d="M3 0H30" fill="none" ${stroke} stroke-width=".9"/></g>
<g id="lfb"><path d="M0 0C7-9 24-10 36 0 24 10 7 9 0 0Z" fill="${c.leafB}" ${stroke} stroke-width="1.3"/><path d="M0 0C7 9 24 10 36 0Z" fill="${c.leafDark}" opacity=".6"/><path d="M3 0H30" fill="none" ${stroke} stroke-width=".9"/></g>
<g id="lfs"><path transform="rotate(90) translate(0 -20)" d="M0-20C10-8 18-2 18 6 18 14 8 16 2 9 3 14 5 18 7 20L-7 20C-5 18-3 14-2 9-8 16-18 14-18 6-18-2-10-8 0-20Z" fill="${c.leafDark}" ${stroke} stroke-width="1.3"/></g>
<g id="ht"><path d="M0 9C-17-4-10-18 0-8 10-18 17-4 0 9Z" fill="${c.rasp}" ${stroke} stroke-width="1.2"/></g>
<g id="bla">${petals(c.petalA)}<circle r="3.4" fill="${c.core}"/></g>
<g id="blb">${petals(c.petalB)}<circle r="3.4" fill="${c.core}"/></g>
<g id="bud"><circle r="4.6" fill="${c.petalA}" ${stroke} stroke-width="1.1"/><path d="M-4 2.5C-1 5 1 5 4 2.5" fill="none" ${stroke} stroke-width="1.1"/></g>
<g id="st"><path d="M0-8Q1.5-1.5 8 0 1.5 1.5 0 8-1.5 1.5-8 0-1.5-1.5 0-8Z" fill="${c.gold}"/></g>
<g id="rec"><circle r="34" fill="${c.record}" stroke="${c.recordEdge}" stroke-width="1.5"/><g fill="none" stroke="${c.groove}" stroke-width=".8" opacity=".55"><circle r="29"/><circle r="24.5"/><circle r="20"/><circle r="16"/></g><path d="M0 0L-31-11A33 33 0 0 1-11-31ZM0 0L31 11A33 33 0 0 1 11 31Z" fill="#fff" opacity=".1"/><circle r="12.5" fill="${c.label}"/><path d="M0-3a3 3 0 0 1 3 3 5 5 0 0 1-5 5 7 7 0 0 1-7-7 9 9 0 0 1 9-9" fill="none" stroke="${c.goldLight}" stroke-width="1.5" stroke-linecap="round"/><circle r="1.7" fill="${c.cream}"/></g>
<g id="wt"><circle cy="-25.5" r="4.6" fill="none" stroke="${c.gold}" stroke-width="2.2"/><rect x="-3" y="-23.5" width="6" height="5" fill="${c.gold}"/><circle r="20" fill="${c.gold}" ${stroke} stroke-width="1.5"/><circle r="15.6" fill="${c.cream}" ${stroke} stroke-width=".9"/><path d="${ticks}" fill="none" ${stroke} stroke-width="1"/><path d="M0 0V-10.5M0 0L7.5 4" fill="none" ${stroke} stroke-width="1.6"/><circle r="1.7" fill="${c.ink}"/></g>
<g id="ms"><path d="M-5 0C-6-10-4-20-3-27L3-27C4-20 6-10 5 0Z" fill="${c.cream}" ${stroke} stroke-width="1.3"/><path d="M-25-26C-25-51 25-51 25-26 12-20-12-20-25-26Z" fill="${c.rasp}" ${stroke} stroke-width="1.4"/><g fill="${c.cream}"><circle cx="-11" cy="-35" r="3.6"/><circle cx="4" cy="-39" r="4.2"/><circle cx="14" cy="-31" r="2.6"/><circle cx="-2" cy="-29" r="2"/></g></g>
<g id="bd"><path d="M-14-14C-32-8-50 2-66 16-48 12-30 4-12-6Z" fill="${c.rasp}" ${stroke} stroke-width="1.2"/><path d="M-14-12C-28 0-38 14-44 32-32 20-22 6-10-6Z" fill="${c.gold}" ${stroke} stroke-width="1.2"/><path d="M-2-8V0M6-8V0" fill="none" ${stroke} stroke-width="1.4"/><path d="M-20-14C-22-28-6-36 8-34 10-40 18-42 24-38 30-34 30-26 26-22 24-12 12-6 0-8-8-8-16-10-20-14Z" fill="${c.cream}" ${stroke} stroke-width="1.4"/><path d="M-15-19C-7-30 9-29 12-21 4-12-8-12-15-19Z" fill="${c.pink}" ${stroke} stroke-width="1.1"/><path d="M28-33L38-30 28-27Z" fill="${c.gold}" ${stroke} stroke-width="1"/><circle cx="21.5" cy="-32.5" r="1.7" fill="${c.ink}"/></g>
<g id="hat"><rect x="-6" y="-15" width="12" height="15" fill="${c.record}" ${stroke} stroke-width="1.1"/><rect x="-6" y="-5" width="12" height="3.4" fill="${c.rasp}"/><path d="M-10.5 0H10.5" fill="none" stroke="${c.record}" stroke-width="3" stroke-linecap="round"/></g>
<g id="rb"><path transform="rotate(-20 16 -80)" d="M12-80C4-100 6-124 14-132 22-124 24-100 20-80Z" fill="${c.cream}" ${stroke} stroke-width="1.4"/><circle cx="-31" cy="-14" r="8.5" fill="${c.cream}" ${stroke} stroke-width="1.4"/><path d="M-30-20C-32-48-12-66 8-64 26-62 31-40 29-22 27-4 10 0-6 0-22 0-30-6-30-20Z" fill="${c.cream}" ${stroke} stroke-width="1.4"/><path d="M6-63C16-60 26-54 29-44 30-32 26-22 20-15 9-18 1-28-1-40Z" fill="${c.rasp}" ${stroke} stroke-width="1.2"/><ellipse cx="8" cy="-4" rx="20" ry="6" fill="${c.cream}" ${stroke} stroke-width="1.4"/><ellipse cx="29" cy="-37" rx="8" ry="4.4" transform="rotate(20 29 -37)" fill="${c.cream}" ${stroke} stroke-width="1.3"/><path d="M6-69C6-79 14-83 24-83 34-83 43-76 43-67 43-59 34-54 24-54 14-54 6-59 6-69Z" fill="${c.cream}" ${stroke} stroke-width="1.4"/><path d="M18-82C10-102 12-126 20-134 28-126 30-102 26-82Z" fill="${c.cream}" ${stroke} stroke-width="1.4"/><path d="M20-88C16-102 17-118 20.5-124 24-118 25-102 23-88Z" fill="${c.pink}" opacity=".8"/><circle cx="30" cy="-71" r="2.1" fill="${c.ink}"/><circle cx="41.5" cy="-67" r="2.1" fill="${c.pink}"/><path d="M36-63L46-60M36-65L47-66" fill="none" ${stroke} stroke-width=".7"/><path d="M12-57L4-62V-52ZM12-57L20-62V-52Z" fill="${c.gold}" ${stroke} stroke-width="1"/></g>
<g id="gr" opacity=".9"><path d="M-36-5C-22 20 22 20 36-5 22 9-22 9-36-5Z" fill="${c.cream}" ${stroke} stroke-width="1.4"/><path d="M-22 5V12M-11 8V16M0 9V17M11 8V16M22 5V12" fill="none" ${stroke} stroke-width="1"/><g fill="${c.goldLight}" ${stroke} stroke-width="1.2"><path d="M-27-28C-22-35-12-35-7-28-12-21-22-21-27-28Z"/><path d="M7-28C12-35 22-35 27-28 22-21 12-21 7-28Z"/></g><ellipse cx="-17" cy="-28" rx="1.6" ry="4.8" fill="${c.ink}"/><ellipse cx="17" cy="-28" rx="1.6" ry="4.8" fill="${c.ink}"/></g>
<g id="bf"><use xlink:href="#ht" transform="translate(-1 0) rotate(-62) translate(0 -9)"/><use xlink:href="#ht" transform="translate(1 0) rotate(62) translate(0 -9)"/><path d="M0-7V8" fill="none" ${stroke} stroke-width="2.4"/><path d="M0-7C-2-12-5-15-8-15M0-7C2-12 5-15 8-15" fill="none" ${stroke} stroke-width=".9"/></g>
<g id="ky"><path d="M0 0V31" fill="none" stroke="${c.rasp}" stroke-width="1.6"/><g fill="none" stroke="${c.gold}" stroke-width="2.8" stroke-linecap="round"><circle cy="38" r="7"/><path d="M0 45V74M0 65H7M0 72H6"/></g></g>`;

  // The main vine climbs the whole tile and leaves the top at the same x
  // and heading it enters the bottom, so stacked tiles join into one stem.
  const vine = trace([
    [[260, 840], [300, 760], [500, 730], [520, 600]],
    [[520, 600], [540, 470], [300, 450], [280, 320]],
    [[280, 320], [260, 190], [220, 120], [260, 40]],
  ], 24);

  // Side branches: where they leave the vine (fraction of its length), then
  // two control points and an end point.
  const limbs = [
    { at: 0.2, c1: [450, 700], c2: [640, 700], end: [716, 610], w: 6.5 },
    { at: 0.09, c1: [280, 740], c2: [150, 760], end: [78, 668], w: 6.5 },
    { at: 0.42, c1: [590, 500], c2: [670, 470], end: [742, 392], w: 6 },
    { at: 0.56, c1: [300, 430], c2: [170, 470], end: [84, 404], w: 6 },
    { at: 0.72, c1: [350, 260], c2: [490, 270], end: [588, 190], w: 6 },
    { at: 0.86, c1: [190, 150], c2: [110, 190], end: [44, 118], w: 5.5 },
    { at: 0.97, c1: [330, 50], c2: [470, 80], end: [560, 14], w: 5 },
  ].map((l) => {
    const from = along(vine, l.at);
    return { ...l, pts: trace([[[from.x, from.y], l.c1, l.c2, l.end]], 26) };
  });

  const wood = [];
  const leaves = [];
  const flowers = [];
  const things = [];

  const leafId = () => {
    const r = rand();
    return r < 0.1 ? "lfs" : r < 0.55 ? "lfa" : "lfb";
  };
  const flower = (x, y, scale = 1) => {
    const r = rand();
    if (r < 0.14) flowers.push(stamp("ht", x, y, between(-25, 25), scale * 0.95));
    else flowers.push(stamp(r < 0.6 ? "bla" : "blb", x, y, between(0, 72), scale));
  };

  /** Leaves down both sides of a traced path. */
  const foliage = (pts, { from = 0.14, to = 0.96, gap = 30, size = 1 } = {}) => {
    const total = pts[pts.length - 1].d;
    let side = rand() < 0.5 ? 1 : -1;
    for (let d = total * from; d < total * to; d += gap * between(0.8, 1.25)) {
      const p = along(pts, d / total);
      const id = leafId();
      const s = size * between(0.75, 1.2) * (id === "lfs" ? 0.7 : 1);
      leaves.push(stamp(id, p.x, p.y, deg(p.a) + side * between(38, 66), s));
      side = -side;
    }
  };

  /** A short twig off a path, ending in blossom. */
  const twig = (pts, frac, side, length) => {
    const p = along(pts, frac);
    const dir = (turn, dist) => [
      p.x + Math.cos(p.a + side * rad(turn)) * dist,
      p.y + Math.sin(p.a + side * rad(turn)) * dist,
    ];
    const t = trace([[[p.x, p.y], dir(70, length * 0.4), dir(52, length * 0.75), dir(34, length)]], 10);
    wood.push(`<path d="${ribbon(t, 3, 1.2)}"/>`);
    foliage(t, { from: 0.25, to: 0.85, gap: 22, size: 0.72 });
    const tip = t[t.length - 1];
    flower(tip.x, tip.y, between(0.95, 1.25));
    const mid = along(t, 0.55);
    flowers.push(stamp("bud", mid.x + side * 7, mid.y - 7, 0, between(0.8, 1.1)));
  };

  wood.push(`<path d="${ribbon(vine, 11, 11)}"/>`);
  foliage(vine, { from: 0.03, to: 0.99, gap: 62, size: 1.05 });

  limbs.forEach((l, i) => {
    wood.push(`<path d="${ribbon(l.pts, l.w, 1.6)}"/>`);
    foliage(l.pts, { gap: 31 });
    const side = i % 2 === 0 ? 1 : -1;
    twig(l.pts, 0.34, side, between(62, 84));
    twig(l.pts, 0.62, -side, between(54, 76));
    twig(l.pts, 0.84, side, between(40, 56));
  });

  // Records for fruit, at the ends of three limbs.
  const fruit = (limb, rot) => {
    const tip = limb.pts[limb.pts.length - 1];
    things.push(stamp("rec", tip.x + Math.cos(tip.a) * 30, tip.y + Math.sin(tip.a) * 30, rot));
  };
  fruit(limbs[0], 20);
  fruit(limbs[3], -40);
  fruit(limbs[4], 75);
  // The other limbs end in blossom.
  [1, 2, 5, 6].forEach((i) => {
    const tip = limbs[i].pts[limbs[i].pts.length - 1];
    flower(tip.x, tip.y, 1.35);
  });

  // The pocket watch, on its chain.
  {
    const p = along(limbs[2].pts, 0.52);
    const drop = 52;
    things.push(
      `<path d="M${n(p.x)} ${n(p.y)}C${n(p.x - 5)} ${n(p.y + 18)} ${n(p.x + 5)} ${n(p.y + 34)} ${n(p.x)} ${n(p.y + drop)}" fill="none" stroke="${c.gold}" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="0 5.2"/>`,
      stamp("wt", p.x, p.y + drop + 30, 6)
    );
  }
  // The golden key, on a ribbon.
  {
    const p = along(limbs[5].pts, 0.5);
    things.push(stamp("ky", p.x, p.y, 4));
  }
  // Birds; the second wears a hat.
  {
    const p = along(limbs[2].pts, 0.24);
    things.push(stamp("bd", p.x, p.y - 2, deg(p.a) * 0.4));
    const q = along(limbs[4].pts, 0.5);
    things.push(
      `<g transform="translate(${n(q.x)} ${n(q.y - 2)}) scale(-1 1)">${stamp("bd", 0, 0)}${stamp("hat", 19, -40, -12)}</g>`
    );
  }
  // The White Rabbit.
  {
    const p = along(limbs[1].pts, 0.46);
    things.push(`<g transform="translate(${n(p.x)} ${n(p.y - 2)}) scale(-1 1)">${stamp("rb", 0, 0)}</g>`);
  }
  // Toadstools on the upper-left limb and the vine.
  {
    const p = along(limbs[5].pts, 0.24);
    things.push(stamp("ms", p.x, p.y, -8, 1), stamp("ms", p.x - 24, p.y + 4, -22, 0.62));
    const q = along(limbs[0].pts, 0.5);
    things.push(stamp("ms", q.x, q.y, 6, 0.8), stamp("ms", q.x + 20, q.y - 2, 20, 0.5));
  }
  // The grin, butterflies and a scatter of stars in the open ground.
  things.push(stamp("gr", 672, 262, -6));
  things.push(stamp("bf", 120, 560, -18, 1.1), stamp("bf", 664, 92, 24, 0.95), stamp("bf", 430, 392, 12, 0.8));
  [
    [176, 300, 1], [612, 318, 0.8], [706, 150, 1.1], [86, 250, 0.8], [560, 560, 0.9],
    [392, 150, 0.7], [150, 520, 0.7], [742, 520, 0.8], [40, 780, 0.9], [470, 800, 0.7],
  ].forEach(([x, y, s]) => things.push(stamp("st", x, y, 0, s)));

  const motif = `<g id="m"><g id="wd">${wood.join("")}</g><use xlink:href="#wd" fill="${c.branch}" stroke="${c.branchShade}" stroke-width="2.4" stroke-linejoin="round"/><use xlink:href="#wd" fill="${c.branch}"/>${leaves.join("")}${flowers.join("")}${things.join("")}</g>`;

  const stamps = [];
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) {
      stamps.push(`<use xlink:href="#m"${dx || dy ? ` transform="translate(${dx} ${dy})"` : ""}/>`);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}"><defs>${defs}\n${motif}</defs>${stamps.join("")}</svg>\n`;
}

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "images");
for (const [name, palette] of Object.entries(PALETTES)) {
  const file = join(out, `chinoiserie-${name}.svg`);
  const svg = build(palette);
  writeFileSync(file, svg);
  console.log(`${file}  ${(svg.length / 1024).toFixed(1)} KB`);
}
