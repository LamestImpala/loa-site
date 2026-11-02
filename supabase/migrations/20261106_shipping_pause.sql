-- Shipping pause / away notice.
--
-- The admin Settings page stores the dates the shop owner is away (and the
-- day orders placed meanwhile ship) as JSON text in settings.shipping_pause;
-- '' means no pause. The shop layout shows a banner, the buy dialog a hint,
-- and the buyer confirmation email a paragraph while the window is open.
--
-- settings has no INSERT policy (the admin can only UPDATE existing keys, and
-- anon reads them), so the row is seeded here, like reddit_post_records.
-- `key` is the primary key, so re-running is a no-op.

insert into public.settings (key, value)
values ('shipping_pause', '')
on conflict (key) do nothing;
