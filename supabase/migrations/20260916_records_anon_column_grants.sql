-- Restrict which columns of `records` the anon role can read.
--
-- RLS already limits anon to listed rows, but row policies don't hide
-- columns: anyone with the publishable key could `select *` on listed
-- records and read admin-only fields — the buyer's Reddit username, the
-- USPS tracking number, sold/negotiated price, PayPal invoice id, order
-- id, and who a record is held for. Sold records stay listed on the shop
-- (they show as sold), so those columns were populated on public rows.
--
-- Table-level SELECT is swapped for a column list that matches exactly
-- what the shop page selects (app/(shop)/records/page.tsx). Any anon
-- query naming another column now fails with "permission denied", which
-- is the point. The authenticated role is untouched: the admin reads
-- every column through its own session and RLS policy.

revoke select on table public.records from anon;

grant select (
  id,
  artist,
  title,
  pressing,
  media,
  sleeve,
  price,
  prev_price,
  notes,
  photos,
  photo_urls,
  discogs_release_id,
  cover_image,
  genres,
  collection,
  sold,
  listed,
  hold_until,
  created_at,
  updated_at
) on table public.records to anon;
