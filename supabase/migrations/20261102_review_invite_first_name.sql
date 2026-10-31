-- Review page greeting: drop punctuation around the first name.
--
-- PayPal sometimes stores the shipping name as "Neal, Hallett", so the
-- first word came through as "Neal," and the page read "How did it go,
-- Neal,?". Same rule as buyerFirstName() in lib/review.ts: strip
-- non-letters from either end of the first word; inner hyphens and
-- apostrophes stay.

create or replace function public.review_invite_info(p_token uuid)
returns table (first_name text, used boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    nullif(regexp_replace(
      split_part(trim(coalesce(
        o.ship_to ->> 'name',
        case when o.buyer_email is not null then o.buyer_username end,
        '')), ' ', 1),
      '^[^[:alpha:]]+|[^[:alpha:]]+$', '', 'g'), ''),
    i.used_at is not null
  from public.review_invites i
  join public.orders o on o.id = i.order_id
  where i.token = p_token;
$$;

revoke all on function public.review_invite_info(uuid) from public;
grant execute on function public.review_invite_info(uuid) to anon, authenticated;
