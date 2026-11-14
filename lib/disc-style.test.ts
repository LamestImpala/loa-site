// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { discFormatsFromDiscogs, discStyle, type DiscFormat } from "./disc-style.ts";

const vinyl = (text: string, qty = "1", descriptions: string[] = []): DiscFormat[] => [
  { qty, text, descriptions },
];
const hexes = (text: string, qty = "1") => discStyle(vinyl(text, qty))?.colors.map((c) => c.hex);

test("a release with no colour note keeps a plain black disc", () => {
  for (const text of ["", "180g", "Gatefold", "180 Gram, Gatefold", "Terre Haute Pressing", "Remastered"]) {
    assert.equal(discStyle(vinyl(text)), null, text);
  }
  assert.equal(discStyle(null), null);
  assert.equal(discStyle([]), null);
  // "Black" is what a disc already is.
  assert.equal(discStyle(vinyl("180 Gram Black")), null);
});

test("packaging notes don't colour the disc", () => {
  assert.equal(discStyle(vinyl("Purple Label, SP - Specialty Pressing, Gatefold")), null);
  assert.equal(discStyle(vinyl("Yellow Cover")), null);
  assert.equal(discStyle(vinyl("Terre Haute Pressing, Black Label")), null);
  // The colour note still counts when a packaging note follows it.
  assert.deepEqual(hexes("Black & Blue Opaque Mix, Blue Color Shift Alternate Cover Art", "2"), [
    "#0c0d12",
    "#1f55b8",
  ]);
});

test("solid and see-through colours", () => {
  assert.deepEqual(discStyle(vinyl("Blue")), {
    mode: "solid",
    colors: [{ hex: "#1f55b8", alpha: 1 }],
    label: "Blue",
  });
  assert.equal(discStyle(vinyl("Red Translucent, 180g"))?.colors[0].alpha, 0.8);
  assert.equal(discStyle(vinyl("Blue [Transparent]"))?.colors[0].alpha, 0.8);
  assert.equal(discStyle(vinyl("Opaque White"))?.colors[0].alpha, 1);
  assert.equal(discStyle(vinyl("Crystal Clear"))?.colors[0].alpha, 0.3);
  assert.equal(discStyle(vinyl("Coke Bottle Clear"))?.colors[0].alpha, 0.8);
  // One see-through colour, not a marble of two.
  assert.deepEqual(discStyle(vinyl("Clear Orange", "2"))?.colors, [{ hex: "#ee7a1c", alpha: 0.72 }]);
  // Longer names win over the plain colour inside them.
  assert.deepEqual(hexes("Baby Blue"), ["#9cc7e8"]);
  assert.deepEqual(hexes("Cobalt Blue"), ["#2452c4"]);
});

test("the label is Discogs' colour note without the other notes", () => {
  assert.equal(discStyle(vinyl("180g, Red Translucent, Gatefold"))?.label, "Red Translucent");
  assert.equal(
    discStyle(vinyl('Blue / Turquoise Galaxy ["Sea of Tranquility"], 180g, Gatefold'))?.label,
    'Blue / Turquoise Galaxy ["Sea of Tranquility"]'
  );
});

test("marble, swirl, galaxy and mix", () => {
  const galaxy = discStyle(vinyl('Blue / Turquoise Galaxy ["Sea of Tranquility"], 180g'));
  assert.equal(galaxy?.mode, "marble");
  assert.deepEqual(galaxy?.colors.map((c) => c.hex), ["#1f55b8", "#3cc1c4"]);
  assert.equal(discStyle(vinyl("Fire Orange w/ Black Swirl"))?.mode, "marble");
  assert.equal(discStyle(vinyl("Black & Red Hi-Melt, 180g", "2"))?.mode, "marble");
  // A one-colour marble gets a darker tone of itself.
  assert.deepEqual(hexes("Brown Marble"), ["#5a3520", "#28180e"]);
  // The nickname in brackets isn't a third colour.
  assert.deepEqual(hexes("Blue & White Marble [Crystal Ball]", "2"), ["#1f55b8", "#f2f0ea"]);
  assert.deepEqual(hexes("Red w/ Orange Swirl [Ruby Blend]", "2"), ["#c41e25", "#ee7a1c"]);
});

test("splatter keeps its colour list together across commas", () => {
  const s = discStyle(vinyl("Clear w/ Black, White, & Grey Splatter"));
  assert.equal(s?.mode, "splatter");
  assert.deepEqual(s?.colors.map((c) => c.hex), ["#dfe9ea", "#0c0d12", "#f2f0ea"]);
  assert.equal(s?.colors[0].alpha, 0.3);
  // One colour named: it splatters on black.
  assert.deepEqual(hexes("Red Splatter"), ["#0c0d12", "#c41e25"]);
});

test("split, colour-in-colour and wedges", () => {
  assert.equal(discStyle(vinyl("Black & White Split", "2"))?.mode, "split");
  const inner = discStyle(vinyl("Colour-In-Colour Blue And Red"));
  assert.equal(inner?.mode, "inner");
  assert.deepEqual(inner?.colors.map((c) => c.hex), ["#1f55b8", "#c41e25"]);
  assert.equal(discStyle(vinyl("Yellow in Clear"))?.mode, "inner");
  assert.equal(discStyle(vinyl("Orange & Blueberry Quad", "2"))?.parts, 4);
  assert.equal(discStyle(vinyl("Clear/Ruby Pinwheel (Beach Ball)"))?.parts, 8);
  assert.equal(discStyle(vinyl("Tri-Colour Red, White & Blue"))?.mode, "stripes");
});

test("two colours on a two-disc set are one disc of each", () => {
  assert.deepEqual(discStyle(vinyl("Opaque Orchid & Canary Yellow, 30th Anniversary", "2")), {
    mode: "solid",
    colors: [{ hex: "#b565c0", alpha: 1 }],
    label: "Opaque Orchid",
  });
  assert.equal(discStyle(vinyl("Coke Bottle Clear & Clear Blue", "2"))?.label, "Coke Bottle Clear");
  // On a single disc the same words are a mix.
  assert.equal(discStyle(vinyl("Black/White, 180g"))?.mode, "marble");
});

test("several vinyl entries: the first that names a colour decides", () => {
  const formats: DiscFormat[] = [
    { qty: "1", text: "", descriptions: ["LP"] },
    { qty: "1", text: "Translucent Orange", descriptions: ["LP"] },
    { qty: "1", text: "Emerald", descriptions: ["LP"] },
  ];
  assert.equal(discStyle(formats)?.label, "Translucent Orange");
});

test("picture discs are flagged, not drawn", () => {
  assert.equal(discStyle(vinyl("", "1", ["LP", "Picture Disc"]))?.mode, "picture");
  assert.equal(discStyle(vinyl("Picture Disc"))?.mode, "picture");
});

test("vinyl formats are read from a Discogs release", () => {
  const rel = {
    formats: [
      { name: "Vinyl", qty: "2", text: " Blue Marble ", descriptions: ["LP", "Album"] },
      { name: "CD", qty: "1", text: "Bonus" },
      { name: "Vinyl" },
    ],
  };
  assert.deepEqual(discFormatsFromDiscogs(rel), [
    { qty: "2", text: "Blue Marble", descriptions: ["LP", "Album"] },
    { qty: "1", text: "", descriptions: [] },
  ]);
  assert.deepEqual(discFormatsFromDiscogs({}), []);
});
