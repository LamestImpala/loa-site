// Reference material, folded away by default.
export default function HowItWorks() {
  return (
    <details className="mt-12 border-t border-white/10 pt-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-300 hover:text-white">How it works</summary>
      <ul className="mt-3 max-w-2xl space-y-2 text-sm leading-6 text-neutral-300">
        <li>Lines are the median across nine US books, refreshed daily and more often on game day. Each button carries the best available price and the book that has it (abbreviated on phones, spelled out under &ldquo;lines &amp; house&rdquo;).</li>
        <li>A pick locks the line and price at that moment. Kickoff freezes it.</li>
        <li>Every pick risks 1 unit. A win at -110 returns 0.91, a +200 dog returns 2.00, a loss costs 1, a push is 0.</li>
        <li>Everyone&apos;s picks become visible once a game kicks off.</li>
        <li>Games in play stay at the top of the board with the score and clock from ESPN, refreshed about every 30 seconds. A dim W or L on a pick is where it stands right now; it turns solid, and the leaderboard moves, once the game is final.</li>
        <li>Every game gets a house call on the spread, total and moneyline from an AI handicapper that reads the lines, the movement, and the week&apos;s news. Fade or follow. A pill on a button marks the house&apos;s side: <span className="text-yellow-300">LEAN</span> is about a 55% shot against the number, <span className="text-emerald-300">LIKE</span> about 58%, <span className="text-emerald-300">BEST</span> 62% or better. No pill means the house thinks the number is fair and passes; its reasoning is still under &ldquo;lines &amp; house&rdquo;. Hover a pill for the house&apos;s reasoning, or tap it to open the game&apos;s lines and house notes.</li>
        <li>House parlays are math, not vibes: each leg&apos;s price becomes a probability, nudged by how much the house likes it, and the legs with the most edge are stacked two to seven deep. The percentage is the house&apos;s own estimate of the ticket hitting; it is usually lower than the price implies, which is the point.</li>
        <li>The college slate is the forty most interesting games of the week: closest Power Four matchups first, and Arkansas always. The NFL slate is every game of the week.</li>
      </ul>
    </details>
  );
}
