// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { discPixels, discSeed } from "./disc-paint.ts";
import type { DiscStyle } from "./disc-style.ts";

const SIZE = 96;
const MID = SIZE / 2;
const style = (mode: DiscStyle["mode"], ...hex: string[]): DiscStyle => ({
  mode,
  colors: hex.map((h) => ({ hex: h, alpha: 1 })),
  label: "test",
});
const at = (px: Uint8ClampedArray, x: number, y: number) => {
  const k = (y * SIZE + x) * 4;
  return { r: px[k], g: px[k + 1], b: px[k + 2], a: px[k + 3] };
};
type Px = ReturnType<typeof at>;
const reddish = (p: Px) => p.r > 120 && p.g < 60 && p.b < 60;
const whitish = (p: Px) => p.r > 170 && p.g > 170 && p.b > 150;
const bluish = (p: Px) => p.b > 90 && p.r < 60;
// How many pixels of the pressed area (between label and rim) pass.
function share(px: Uint8ClampedArray, pass: (p: Px) => boolean) {
  let n = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.hypot(x + 0.5 - MID, y + 0.5 - MID) / MID;
      if (d > 0.45 && d < 0.93 && pass(at(px, x, y))) n++;
    }
  }
  return n;
}

test("a record's seed is steady, and differs from the next record's", () => {
  assert.equal(discSeed(20), discSeed(20));
  assert.notEqual(discSeed(20), discSeed(21));
  assert.ok(discSeed(20) >= 0 && discSeed(20) < 40);
});

test("the same disc is painted every time, a different one per seed", () => {
  const marble = style("marble", "#c41e25", "#f2f0ea");
  const a = discPixels(marble, 3, SIZE);
  assert.deepEqual(discPixels(marble, 3, SIZE), a);
  assert.notDeepEqual(discPixels(marble, 19, SIZE), a);
});

test("clear outside the circle, with a spindle hole and a cream label", () => {
  const px = discPixels(style("solid", "#c41e25"), 1, SIZE);
  assert.equal(at(px, 0, 0).a, 0);
  assert.equal(at(px, SIZE - 1, SIZE - 1).a, 0);
  const hole = at(px, MID, MID);
  assert.ok(hole.r < 20 && hole.a === 255);
  // Below the maroon centre, on the side of the label with no print.
  const label = at(px, MID, Math.round(MID + SIZE * 0.08));
  assert.ok(label.r > 170 && label.g > 130 && label.a === 255);
});

test("a solid disc is its colour all over", () => {
  const px = discPixels(style("solid", "#c41e25"), 1, SIZE);
  assert.equal(share(px, reddish), share(px, () => true));
});

test("a see-through pressing stays see-through", () => {
  const clear: DiscStyle = {
    mode: "solid",
    colors: [{ hex: "#2a8a45", alpha: 0.8 }],
    label: "Translucent Green",
  };
  const { a } = at(discPixels(clear, 1, SIZE), Math.round(SIZE * 0.82), MID);
  assert.ok(a > 180 && a < 255);
});

test("a marble and a splatter show both colours", () => {
  for (const mode of ["marble", "splatter"] as const) {
    const px = discPixels(style(mode, "#c41e25", "#f2f0ea"), 5, SIZE);
    assert.ok(share(px, reddish) > 40, `${mode}: first colour`);
    assert.ok(share(px, whitish) > 40, `${mode}: second colour`);
  }
});

test("a three-colour splatter shows the third", () => {
  const px = discPixels(style("splatter", "#f2f0ea", "#c41e25", "#1f55b8"), 5, SIZE);
  assert.ok(share(px, bluish) > 20);
});

test("colour-in-colour with a third colour splatters it over both", () => {
  const two = discPixels(style("inner", "#c41e25", "#f2f0ea"), 5, SIZE);
  const px = discPixels(style("inner", "#c41e25", "#f2f0ea", "#1f55b8"), 5, SIZE);
  assert.equal(share(two, bluish), 0);
  assert.ok(share(px, bluish) > 20);
  assert.ok(share(px, reddish) > 40 && share(px, whitish) > 40);
});

test("split, colour-in-colour and wedges land where the words say", () => {
  const split = discPixels(style("split", "#c41e25", "#f2f0ea"), 1, SIZE);
  assert.ok(reddish(at(split, MID, 8)));
  assert.ok(whitish(at(split, MID, SIZE - 9)));

  const inner = discPixels(style("inner", "#c41e25", "#f2f0ea"), 1, SIZE);
  assert.ok(reddish(at(inner, Math.round(SIZE * 0.72), MID)));
  assert.ok(whitish(at(inner, SIZE - 4, MID)));

  const wedges = discPixels({ ...style("wedges", "#c41e25", "#f2f0ea"), parts: 8 }, 1, SIZE);
  const red = share(wedges, reddish);
  const white = share(wedges, whitish);
  assert.ok(Math.abs(red - white) < (red + white) * 0.15);
});

test("a disc with no colours paints nothing", () => {
  const px = discPixels({ mode: "picture", colors: [], label: "Picture disc" }, 1, SIZE);
  assert.ok(px.every((v) => v === 0));
});
