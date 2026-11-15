-- A weekly Reddit post promises its prices for a week. hold_until is when
-- that promise ends; while it runs (and retired_at is null) the daily price
-- run and the admin leave the prices of the post's record_ids alone.
alter table public.reddit_posts
  add column if not exists hold_until timestamptz;

comment on column public.reddit_posts.hold_until is
  'Prices of this post''s record_ids are held until this time (weekly posts). The hold also ends when the post is retired. Null = no price hold.';
