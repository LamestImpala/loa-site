// Reference material, folded away by default.
export default function HowItWorks() {
  return (
    <details className="mt-12 border-t border-white/10 pt-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-300 hover:text-white">How it works</summary>
      <ul className="mt-3 max-w-2xl space-y-2 text-sm leading-6 text-neutral-300">
        <li>Lines are the median across nine US books, refreshed three times a day. Each button carries the best available price and the book that has it (abbreviated on phones, spelled out under &ldquo;lines &amp; house&rdquo;).</li>
        <li>A pick locks the line and price at that moment. Kickoff freezes it.</li>
        <li>Every pick risks 1 unit. A win at -110 returns 0.91, a +200 dog returns 2.00, a loss costs 1, a push is 0.</li>
        <li>Everyone&apos;s picks become visible once a game kicks off.</li>
        <li>Every game gets house picks on the spread, total and moneyline from an AI handicapper that reads the lines, the movement, and the week&apos;s news. Fade or follow. A circled number on a button marks the house&apos;s side and its confidence: green and bold at 7 or higher (about a 58% shot or better against the number), yellow below that.</li>
        <li>House parlays are math, not vibes: each leg&apos;s price becomes a probability, nudged by the house confidence, and the legs with the most edge are stacked two to seven deep. The percentage is the house&apos;s own estimate of the ticket hitting; it is usually lower than the price implies, which is the point.</li>
        <li>The slate is the forty most interesting games of the week: closest Power Four matchups first, and Arkansas always.</li>
      </ul>
    </details>
  );
}
