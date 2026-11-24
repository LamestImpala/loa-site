-- Two-step sign-in for the admin, enforced in the database (security
-- slice 4).
--
-- !! Apply ONLY AFTER the owner has set up an authenticator app in
-- !! Settings and signed in to the admin once with its code. From the
-- !! moment this runs, a session that has not given a code can read and
-- !! change nothing in the admin's tables. Applied before an authenticator
-- !! exists, the admin shows nothing until one is set up (the sign-in page
-- !! then offers the setup, so it is recoverable, but nothing works until
-- !! it is done).
--
-- How it works. Supabase marks a session that has passed a second factor
-- with the claim aal = 'aal2' inside its access token (password or magic
-- link alone is 'aal1'). The policies below are RESTRICTIVE: they don't
-- grant anything, they are AND-ed on top of the existing "admin ..."
-- policies, which keep checking the owner's email. So the rule becomes
-- "the owner's email AND a code given this session".
--
-- Who is not affected:
--   - shoppers (the anon role): the policies are for `authenticated` only,
--     so the public reads of listed records, settings and photos are as
--     they were;
--   - pick'em players: none of their tables (games, picks, profiles,
--     parlays, tails, wagers, slip imports, line history) gets a policy
--     here, so they sign in and play without a second factor as before;
--   - the server's own jobs (cron, webhooks, the order and tracking
--     routes): they use the service role, which bypasses row level
--     security.
--
-- Lost the authenticator and its setup key? In the Supabase dashboard
-- (its login is separate from the shop's) run, in the SQL editor:
--     delete from auth.mfa_factors
--     where user_id = (select id from auth.users where email = '<owner email>');
-- then sign in to the admin with the password: it asks to set up a new
-- authenticator before it opens.
--
-- Safe to run twice: each policy is dropped and made again.

-- ---------------------------------------------------------------------
-- 1. Tables only the admin reads or writes as a signed-in user.
--
--    `records` belongs here too: its one public policy is for the anon
--    role; every policy a signed-in user can match is the admin's.
--    `market_snapshots` was readable by any signed-in account (pick'em
--    players included); only the admin's pages read it, so it now needs a
--    code as well.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'discogs_imports',
    'invoices',
    'market_snapshots',
    'order_requests',
    'orders',
    'pending_price_changes',
    'pickem_book_lines',
    'pickem_engine_plays',
    'pickem_job_runs',
    'pickem_model_lines',
    'price_history',
    'price_runs',
    'record_events',
    'records',
    'reddit_posts',
    'review_invites',
    'shipments',
    'shop_messages',
    'shop_reviews',
    'shop_visits'
  ]
  loop
    execute format(
      'drop policy if exists "admin needs two-step sign-in" on public.%I', t);
    execute format(
      'create policy "admin needs two-step sign-in" on public.%I '
      'as restrictive for all to authenticated '
      'using ((select auth.jwt() ->> ''aal'') = ''aal2'') '
      'with check ((select auth.jwt() ->> ''aal'') = ''aal2'')', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. settings: anyone may read it (the shop's away notice), only the
--    admin may change it. The code is required for the change only.
-- ---------------------------------------------------------------------
drop policy if exists "admin needs two-step sign-in" on public.settings;
create policy "admin needs two-step sign-in" on public.settings
  as restrictive for update to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2')
  with check ((select auth.jwt() ->> 'aal') = 'aal2');

-- ---------------------------------------------------------------------
-- 3. Record photos (storage bucket record-photos): anyone may view, only
--    the admin may upload or delete. The code is required for those two;
--    other buckets, should any be added, are untouched.
-- ---------------------------------------------------------------------
drop policy if exists "record photo uploads need two-step sign-in" on storage.objects;
create policy "record photo uploads need two-step sign-in" on storage.objects
  as restrictive for insert to authenticated
  with check (
    bucket_id is distinct from 'record-photos'
    or (select auth.jwt() ->> 'aal') = 'aal2'
  );

drop policy if exists "record photo deletes need two-step sign-in" on storage.objects;
create policy "record photo deletes need two-step sign-in" on storage.objects
  as restrictive for delete to authenticated
  using (
    bucket_id is distinct from 'record-photos'
    or (select auth.jwt() ->> 'aal') = 'aal2'
  );
