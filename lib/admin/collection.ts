// Known curated series, matched against Discogs label/series/company names
// and format descriptions. Order matters: first match wins, so the more
// specific series (e.g. UHQR) come before their parent label.
const COLLECTION_PATTERNS: [RegExp, string][] = [
  [/vinyl me,? please/i, "VMP"],
  [/interscope vinyl collective/i, "IVC"],
  [/uhqr|ultra high quality record/i, "UHQR"],
  [/rhino high fidelity|rhino hi-?fi/i, "RHF"],
  [/atlantic 75/i, "Atlantic 75"],
  [/definitive sound/i, "Definitive Sound"],
  [/tone poet/i, "Tone Poet"],
  [/mobile fidelity|mofi/i, "MoFi"],
  [/acoustic sounds/i, "Acoustic Sounds"],
  [/analogue productions/i, "Analogue Productions"],
];

export type DiscogsReleaseLike = {
  labels?: { name?: string }[];
  series?: { name?: string }[];
  companies?: { name?: string }[];
  formats?: { descriptions?: string[]; text?: string }[];
};

export function detectCollection(rel: DiscogsReleaseLike): string {
  const haystack = [
    ...[...(rel.labels ?? []), ...(rel.series ?? []), ...(rel.companies ?? [])].map(
      (x) => x.name ?? ""
    ),
    ...(rel.formats ?? []).flatMap((f) => [
      ...(f.descriptions ?? []),
      f.text ?? "",
    ]),
  ];
  for (const [re, tag] of COLLECTION_PATTERNS) {
    if (haystack.some((n) => re.test(n))) return tag;
  }
  return "";
}
