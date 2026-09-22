-- Drop-off: when a box actually left the house.
--
-- Tracking is saved when the label sheet prints, before the labels go on,
-- and labeled boxes can sit on the table for days before the post office
-- run. shipments.sent_at is set by "Mark dropped off" on /admin/pack; the
-- Letter order sheet lists every paid order with a record not yet in a
-- sent box. Boxes labeled before 2026-09-14 had all gone out, so they're
-- backfilled as sent at their last update.
alter table public.shipments
  add column if not exists sent_at timestamptz;

comment on column public.shipments.sent_at is
  'When the labeled box was dropped off with the carrier (Mark dropped off on /admin/pack). Null = still in the house.';

update public.shipments
  set sent_at = coalesce(updated_at, created_at)
  where sent_at is null
    and tracking_code is not null
    and created_at < timestamptz '2026-09-14 00:00:00-07';
