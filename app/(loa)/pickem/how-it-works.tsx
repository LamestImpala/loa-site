// Reference material, folded away by default.
export default function HowItWorks() {
  return (
    <details className="mt-12 border-t border-white/10 pt-3">
      <summary className="cursor-pointer select-none text-sm font-medium text-neutral-300 hover:text-white">How it works</summary>
      <ul className="mt-3 max-w-2xl space-y-2 text-sm leading-6 text-neutral-300">
        <li>Lines are the median across nine US books, refreshed three times a day. Each button carries the best available price; the book that has it shows on wider screens and under &ldquo;lines &amp; house&rdquo;.</li>
        <li>A pick locks the line and price at that moment. Kickoff freezes it.</li>
        <li>Every pick risks 1 unit. A win at -110 returns 0.91, a +200 dog returns 2.00, a loss costs 1, a push is 0.</li>
        <li>Everyone&apos;s picks become visible once a game kicks off.</li>
        <li>House picks come from an AI handicapper that reads the lines, the movement, and the week&apos;s news. Fade or follow. H7 on a button means the house likes that side at 7 out of 10.</li>
        <li>The slate is the forty most interesting games of the week: closest Power Four matchups first, and Arkansas always.</li>
      </ul>
    </details>
  );
}
