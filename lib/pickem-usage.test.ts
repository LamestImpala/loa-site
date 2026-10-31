// node --test lib/
import { test } from "node:test";
import assert from "node:assert/strict";
import { callCostUsd, fmtTokens, modelPrices, runCost, spendByWeek, spendTotal, sumUsage, type JobRunRow, type UsageLike } from "./pickem-usage.ts";

const usage = (input: number, output: number, extra: Partial<UsageLike> = {}): UsageLike => ({ input_tokens: input, output_tokens: output, ...extra });

test("sumUsage adds every priced field and skips calls without usage", () => {
  const t = sumUsage([
    usage(1000, 200, { cache_read_input_tokens: 50, cache_creation_input_tokens: 10, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } }),
    usage(500, 100, { cache_read_input_tokens: null, server_tool_use: null }),
    undefined,
    null,
  ]);
  assert.deepEqual(t, { calls: 2, input_tokens: 1500, cache_read_tokens: 50, cache_write_tokens: 10, output_tokens: 300, web_searches: 2 });
});

test("callCostUsd prices each kind of token at the model's rate plus a cent a search", () => {
  // 1M input at $4, 100k output at $20, 1M cache reads at $0.20, 2 searches.
  const u = usage(1_000_000, 100_000, { cache_read_input_tokens: 1_000_000, server_tool_use: { web_search_requests: 2 } });
  assert.equal(callCostUsd(u, "claude-opus-5-5")?.toFixed(2), "6.22");
  // The fallback model has its own price; an unknown model has none.
  assert.ok(callCostUsd(u, "claude-opus-4-8")! > callCostUsd(u, "claude-opus-5-5")!);
  assert.equal(callCostUsd(u, "claude-something-else"), null);
  assert.equal(callCostUsd(u, null), null);
});

test("modelPrices matches a dated id by its longest known prefix", () => {
  assert.equal(modelPrices("claude-opus-5-5-20260401"), modelPrices("claude-opus-5-5"));
  assert.notEqual(modelPrices("claude-opus-5-5"), modelPrices("claude-opus-5"));
  assert.equal(modelPrices(undefined), undefined);
});

test("runCost sums the priced calls, counts the unpriced ones and ignores calls without usage", () => {
  const calls = [
    { usage: usage(100_000, 10_000), model: "claude-opus-5-5" }, // 0.4 + 0.2
    { usage: usage(100_000, 10_000) }, // default model, same again
    { usage: usage(100_000, 10_000), model: "claude-mystery" },
    { usage: undefined, model: "claude-opus-5-5" },
  ];
  assert.deepEqual(runCost(calls, "claude-opus-5-5"), { cost_usd: 1.2, unpriced: 1 });
  assert.deepEqual(runCost([], "claude-opus-5-5"), { cost_usd: 0, unpriced: 0 });
});

const row = (started_at: string, job: "house" | "research", cost: number | string | null, extra: Partial<JobRunRow> = {}): JobRunRow => ({
  league: "ncaaf",
  job,
  dry: false,
  started_at,
  calls: 1,
  input_tokens: 1000,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  output_tokens: 100,
  web_searches: 1,
  cost_usd: cost,
  ...extra,
});

test("spendByWeek groups one league's runs by season week, newest first, and splits house from research", () => {
  // College week 8 runs Tue 2026-10-20 10:00 UTC to Tue 2026-10-27 10:00 UTC.
  const weeks = spendByWeek(
    [
      row("2026-10-20T14:00:00Z", "house", "2.50"), // week 8 number pass
      row("2026-10-23T14:00:00Z", "research", 6, { calls: 20, web_searches: 60 }), // week 8 research
      row("2026-10-24T15:00:00Z", "house", 1, { dry: true }), // week 8 dry run
      row("2026-10-27T09:59:00Z", "house", 1), // still week 8, an hour before the rollover
      row("2026-10-13T14:00:00Z", "house", 3), // week 7
      row("2026-10-13T15:00:00Z", "house", 99, { league: "nfl" }), // other league
      row("2026-10-13T16:00:00Z", "house", null), // unpriced: counts, costs nothing
    ],
    "ncaaf"
  );
  assert.deepEqual(
    weeks.map((w) => [w.week, w.runs, w.calls, w.web_searches, w.house_usd, w.research_usd, w.dry_usd, w.cost_usd]),
    [
      [8, 4, 23, 63, 4.5, 6, 1, 10.5],
      [7, 2, 2, 2, 3, 0, 0, 3],
    ]
  );
  const total = spendTotal(weeks);
  assert.equal(total.cost_usd, 13.5);
  assert.equal(total.runs, 6);
  // Cached tokens count as input tokens read.
  assert.equal(spendByWeek([row("2026-10-20T14:00:00Z", "house", 1, { cache_read_tokens: 500, cache_write_tokens: 20 })], "ncaaf")[0].input_tokens, 1520);
});

test("spendByWeek counts a run that failed before its first call; it costs nothing", () => {
  const weeks = spendByWeek(
    [
      row("2026-10-28T21:00:00Z", "research", null, { league: "nfl", calls: 0, input_tokens: 0, output_tokens: 0, web_searches: 0, detail: { error: "fetch failed" } }),
      row("2026-10-29T14:00:00Z", "research", 5, { league: "nfl", detail: null }),
    ],
    "nfl"
  );
  assert.equal(weeks.length, 1);
  assert.deepEqual([weeks[0].runs, weeks[0].failed_runs, weeks[0].calls, weeks[0].cost_usd], [2, 1, 1, 5]);
  assert.equal(spendTotal(weeks).failed_runs, 1);
});

test("fmtTokens", () => {
  assert.equal(fmtTokens(950), "950");
  assert.equal(fmtTokens(2_400), "2.4k");
  assert.equal(fmtTokens(45_678), "46k");
  assert.equal(fmtTokens(3_210_000), "3.2M");
});
