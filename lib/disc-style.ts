// What colour is the record itself? Discogs notes it in the release's vinyl
// format text ("Blue Translucent", "Clear With Red Splatter", "Orange & Black
// Marble"). records.disc_formats keeps those lines as Discogs wrote them;
// discStyle() turns them into something the 3D crate can draw
// (app/(shop)/records/crate-scene.ts). A release with no colour note returns
// null and keeps a plain black disc.

// One Vinyl entry of a Discogs release's `formats`.
export type DiscFormat = { qty: string; text: string; descriptions: string[] };

export type DiscColor = { hex: string; alpha: number }; // alpha < 1 = see-through

export type DiscMode =
  | "solid"
  | "marble"
  | "splatter"
  | "split"
  | "inner" // colour-in-colour: colors[0] inside colors[1]
  | "stripes"
  | "wedges" // cornetto / pinwheel / quad
  | "picture"; // can't be drawn from words: the disc stays in its sleeve

export type DiscStyle = {
  mode: DiscMode;
  colors: DiscColor[]; // 1–3; empty for a picture disc
  label: string; // Discogs' own wording, shown to the buyer
  parts?: number; // wedges only: how many
};

// The lines records.disc_formats stores, from a Discogs /releases/:id
// response. Same shape as discFormats() in scripts/price-run.mjs (keep the
// two in step).
export function discFormatsFromDiscogs(rel: {
  formats?: { name?: string; qty?: string; text?: string; descriptions?: string[] }[];
}): DiscFormat[] {
  return (rel.formats ?? [])
    .filter((f) => f.name === "Vinyl")
    .map((f) => ({
      qty: f.qty ?? "1",
      text: f.text?.trim() ?? "",
      descriptions: f.descriptions ?? [],
    }));
}

const BLACK = "#0c0d12";
const CLEAR = "#dfe9ea";

// Longest phrases first, so "baby blue" wins over "blue".
const COLOURS = (
  [
    ["coke bottle( clear| green)?", "#a9d8c4", true],
    ["sea ?glass", "#9fd3c0", true],
    ["glow in the dark", "#dcefb6"],
    ["candy floss|cotton candy", "#f6b6d2"],
    ["(baby|sky|light|powder|pastel) blue", "#9cc7e8"],
    ["ice blue", "#bfe0ee"],
    ["(royal|cobalt|electric) blue|cobalt", "#2452c4"],
    ["(navy|dark|midnight|deep) blue|navy", "#1c2b63"],
    ["blueberry", "#3b4f9e"],
    ["(hot|neon) pink|magenta|fuchsia", "#e8318a"],
    ["(baby|light|pastel) pink|bubblegum", "#f3b9cf"],
    ["(blood|dark|deep) red|oxblood", "#7d1016"],
    ["ruby|crimson|cherry|scarlet", "#b3122b"],
    ["burgundy|maroon|wine|merlot", "#6b1a2c"],
    ["(forest|dark|deep) green|emerald|evergreen", "#1f5a3a"],
    ["lime|neon green", "#9fd42a"],
    ["mint|sea ?foam", "#a6dcc0"],
    ["olive|army green|swamp green|moss", "#6b6b2c"],
    ["teal", "#1f8a8a"],
    ["turquoise|aqua(marine)?|cyan", "#3cc1c4"],
    ["lavender|lilac", "#b9a3dc"],
    ["violet", "#6d3fb0"],
    ["orchid", "#b565c0"],
    ["grape|plum|eggplant|aubergine", "#5a2a6a"],
    ["purple", "#6a2c91"],
    ["tangerine", "#f28a1e"],
    ["peach|apricot|coral|salmon", "#f4a583"],
    ["amber|honey", "#d8901f"],
    ["orange", "#ee7a1c"],
    ["mustard", "#c99a1e"],
    ["canary yellow|yellow|lemon|canary", "#f2d21f"],
    ["gold(en)?", "#c9a13b"],
    ["bronze|copper", "#a8683a"],
    ["platinum|pearl", "#d9dadd"],
    ["silver", "#b9bcc2"],
    ["charcoal", "#3b3d42"],
    ["gr[ae]y|smok[ey]y?|ash|stone", "#74777c"],
    ["chocolate|coffee|root ?beer|cola|brown", "#5a3520"],
    ["sandstone|tan|sand|beige|khaki", "#cdb48a"],
    ["cream|bone|ivory|eggshell|natural|milky?", "#ece3cf"],
    ["white", "#f2f0ea"],
    ["(ultra |crystal )?clear|crystal", CLEAR],
    ["black", BLACK],
    ["red", "#c41e25"],
    ["blue", "#1f55b8"],
    ["green", "#2a8a45"],
    ["pink|rose", "#ee7fae"],
  ] as [string, string, boolean?][]
).map(([pattern, hex, see]) => ({
  re: new RegExp(`\\b(?:${pattern})\\b`, "g"),
  hex,
  see: see === true, // a colour that is see-through by name
}));

const EFFECTS: [DiscMode, RegExp][] = [
  ["splatter", /splatter|splattered|speckle|speckled|\bdust\b/],
  ["inner", /colou?r[- ]in[- ]colou?r|\binside\b|\bblob\b|\bcore\b/],
  ["wedges", /cornetto|pinwheel|\bquad\b|butterfly|beach ball/],
  ["split", /\bsplit\b|\bhalf\b/],
  ["stripes", /strip(e|ed|es)\b|tri[- ]?colou?r/],
  [
    "marble",
    /marbled?|swirls?|swirled|galaxy|nebula|\bmix(ed)?\b|smush|haze|cloudy|tie[- ]?dye|burst|melt|merge|smoke\b/,
  ],
];

// A note about the packaging, not the record: "Purple Label", "Yellow Cover".
const NOT_THE_DISC =
  /\b(label|cover|sleeve|jacket|slipcase|insert|poster|obi|artwork|print(ed)?)\b/;
const JOINER = /\s*(?:&|\/|\+|\band\b)\s*/;

type Found = { at: number; hex: string; see: boolean };

function findColours(text: string): Found[] {
  const taken = new Array<boolean>(text.length).fill(false);
  const found: Found[] = [];
  for (const c of COLOURS) {
    c.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(text))) {
      let free = true;
      for (let k = m.index; k < m.index + m[0].length; k++) if (taken[k]) free = false;
      if (!free) continue;
      for (let k = m.index; k < m.index + m[0].length; k++) taken[k] = true;
      found.push({ at: m.index, hex: c.hex, see: c.see });
    }
  }
  return found
    .sort((a, b) => a.at - b.at)
    .filter((f, k, all) => k === 0 || f.hex !== all[k - 1].hex);
}

// The variant's nickname sits in brackets or quotes ("Blue & White Marble
// [Crystal Ball]"): read the plain words first, the nickname only as a fallback.
function coloursIn(text: string): Found[] {
  const plain = text.replace(/\[[^\]]*\]|\([^)]*\)|"[^"]*"/g, " ");
  const found = findColours(plain);
  return found.length ? found : findColours(text.replace(/[\[\]()"]/g, " "));
}

// Mix a hex colour toward black, for the second tone of a one-colour marble.
function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

function parsePart(raw: string, qty: number): DiscStyle | null {
  const text = raw.toLowerCase();
  const found = coloursIn(text);
  if (!found.length) return null;

  const see = /transluc|transparent|\btrans\b|see[- ]through/.test(text);
  const opaque = /opaque|solid/.test(text);
  let colors: DiscColor[] = found.map((f) => ({
    hex: f.hex,
    alpha: f.hex === CLEAR ? 0.3 : (see || f.see) && !opaque ? 0.8 : 1,
  }));
  let mode: DiscMode = EFFECTS.find(([, re]) => re.test(text))?.[0] ?? "solid";

  if (mode === "solid" && colors.length > 1) {
    const pieces = text.split(JOINER);
    if (qty >= 2 && pieces.length === qty && pieces.every((p) => coloursIn(p).length)) {
      // "Red / Blue" on a 2×LP is one disc of each: show the first.
      return parsePart(raw.split(JOINER)[0], 1);
    }
    if (colors.length === 2 && /\bin\b/.test(text)) {
      mode = "inner";
    } else if (colors.length === 2 && colors.filter((c) => c.hex === CLEAR).length === 1) {
      // "Clear Blue" / "Blue Clear": one see-through colour, not two.
      colors = colors.filter((c) => c.hex !== CLEAR).map((c) => ({ ...c, alpha: 0.72 }));
    } else {
      mode = "marble";
    }
  }
  if (mode === "splatter" && colors.length === 1) {
    colors = [{ hex: BLACK, alpha: 1 }, colors[0]];
  }
  if (mode !== "solid" && mode !== "splatter" && colors.length === 1) {
    colors = [colors[0], { hex: shade(colors[0].hex, 0.55), alpha: colors[0].alpha }];
  }
  // Plain black needs no special drawing or tag.
  if (mode === "solid" && colors[0].hex === BLACK && colors[0].alpha === 1) return null;

  const style: DiscStyle = { mode, colors: colors.slice(0, 3), label: raw.trim().slice(0, 60) };
  if (mode === "wedges") style.parts = /\bquad\b/.test(text) ? 4 : 8;
  return style;
}

function parseText(raw: string, qty: number): DiscStyle | null {
  if (/picture disc/i.test(raw)) return { mode: "picture", colors: [], label: "Picture disc" };
  // Discogs strings several notes together ("Blue Marble, 180g, Gatefold").
  // Keep the first run of notes that describe the disc's colour; a list such
  // as "Clear w/ Black, White, & Grey Splatter" stays together.
  const notes = raw.split(/[,;]/).map((n) => n.trim());
  const isColour = (n: string) =>
    !NOT_THE_DISC.test(n.toLowerCase()) && coloursIn(n.toLowerCase()).length > 0;
  const start = notes.findIndex(isColour);
  if (start === -1) return null;
  let end = start;
  while (end + 1 < notes.length && isColour(notes[end + 1])) end++;
  return parsePart(notes.slice(start, end + 1).join(", "), qty);
}

// The first vinyl entry that names a colour decides; a multi-disc set with a
// different colour per disc shows its first.
export function discStyle(formats: DiscFormat[] | null | undefined): DiscStyle | null {
  if (!Array.isArray(formats)) return null;
  for (const f of formats) {
    if ((f?.descriptions ?? []).includes("Picture Disc")) {
      return { mode: "picture", colors: [], label: "Picture disc" };
    }
    const style = f?.text ? parseText(f.text, Number(f.qty) || 1) : null;
    if (style) return style;
  }
  return null;
}

export type DiscColourLine = { label: string; colors: DiscColor[] };

// Every disc's colour, for the record page's Pressing list. discStyle() picks
// one disc for the crate to draw; this keeps them all, in Discogs' wording,
// so a set pressed as one green and one tangerine disc lists both. Plain
// black gets no line, the same as it gets no tag in the crate.
export function discColourLines(formats: DiscFormat[] | null | undefined): DiscColourLine[] {
  if (!Array.isArray(formats)) return [];
  const lines: DiscColourLine[] = [];
  for (const f of formats) {
    const style = (f?.descriptions ?? []).includes("Picture Disc")
      ? { label: "Picture disc", colors: [] }
      : f?.text
        ? // As one disc, so "Red / Blue" on a 2×LP keeps both colours.
          parseText(f.text, 1)
        : null;
    if (!style) continue;
    const label = style.label.replace(/\.$/, "");
    if (!lines.some((l) => l.label === label)) lines.push({ label, colors: style.colors });
  }
  return lines;
}
