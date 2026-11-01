-- shop_reviews_published(): every published review, newest first, for the
-- shop's /reviews page. The home page quotes only three
-- (shop_review_summary), so a buyer whose review isn't among them can
-- still find it. Same columns as those quotes; anon still can't read the
-- table itself.
create or replace function public.shop_reviews_published()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(q order by q.reviewed_on desc, q.id desc), '[]'::jsonb)
  from (
    select id, reviewer_name, rating, body, source, reviewed_on, owner_reply, featured
    from public.shop_reviews
    where status = 'published'
  ) q;
$$;

revoke all on function public.shop_reviews_published() from public;
grant execute on function public.shop_reviews_published() to anon, authenticated;
