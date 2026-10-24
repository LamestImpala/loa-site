-- What each Claude job cost. The house and research routes add up the usage
-- their calls report (lib/pickem-usage.ts) and write one row per run, dry
-- runs included, since a preview spends the same money as a real run. The
-- admin page adds the rows up by season week; the route's JSON carries the
-- same numbers as `spend`. cost_usd is an estimate at list prices, not the
-- invoice. A run that made no Claude call (a gap-fill run with nothing to
-- pick, ?only=parlays) writes nothing.
create table public.pickem_job_runs (
  id bigint generated always as identity primary key,
  league text not null,
  job text not null check (job in ('house', 'research')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  dry boolean not null default false,
  model text,
  effort text,
  -- The run's options: force, only_parlays, scope (games, since) for the
  -- house; games for research.
  params jsonb,
  -- Calls that reported usage, and calls that did not (timeout, refusal,
  -- deadline), which cost something too but cannot be counted.
  calls int not null,
  failed int not null default 0,
  input_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(10, 4),
  -- Calls at a model with no price in lib/pickem-usage.ts, left out of cost_usd.
  unpriced int not null default 0,
  -- What the run did: week, picked, missing, variants for the house;
  -- candidates, researched, skipped_fresh, missing for research.
  detail jsonb
);
create index pickem_job_runs_league_idx on public.pickem_job_runs (league, started_at desc);

-- Written by the jobs (service role). Read by the admin page, signed in as
-- the owner, the same test the orders table uses.
alter table public.pickem_job_runs enable row level security;
create policy "admin reads job runs" on public.pickem_job_runs
  for select
  using ((select auth.jwt() ->> 'email') = 'brandoncgillihan@gmail.com');
grant select on public.pickem_job_runs to authenticated;
