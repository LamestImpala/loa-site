-- Delivery: when a mailed box reached the buyer.
--
-- /api/delivery-check (Vercel cron) asks Shippo for the carrier status of
-- every box dropped off in the last 30 days that hasn't been delivered,
-- and writes what it hears here. The review email then goes out a few
-- days after delivery instead of on the fixed 10-days-after-drop-off
-- timer (which stays as the fallback when tracking never says delivered).
-- Boxes handed over in person never get checked: sent_at is their arrival.
alter table public.shipments
  add column if not exists delivered_at timestamptz,
  add column if not exists tracking_status text,
  add column if not exists tracking_detail text,
  add column if not exists tracking_checked_at timestamptz;

comment on column public.shipments.delivered_at is
  'When the carrier scanned the box delivered (from Shippo via /api/delivery-check). Null = not delivered yet, or never tracked.';
comment on column public.shipments.tracking_status is
  'Latest carrier status from Shippo: PRE_TRANSIT, TRANSIT, DELIVERED, RETURNED, FAILURE or UNKNOWN.';
comment on column public.shipments.tracking_detail is
  'The carrier''s wording for the latest scan, with its place, e.g. "Delivered, Front Door/Porch — OLYMPIA, WA".';
comment on column public.shipments.tracking_checked_at is
  'When /api/delivery-check last asked Shippo about this box. Null = never checked (older boxes).';
