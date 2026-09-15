-- Ship day: the pack step and label intake.
--
-- orders.ship_to is where the buyer wants the parcel, as PayPal reports
-- it once the invoice is paid (read on "Check PayPal" and "Sync from
-- PayPal"; overwritten each time, PayPal being the truth). The name is
-- what the shipping label prints, so a label PDF dropped on /admin/labels
-- can be matched back to its box. Off-PayPal sales leave it null.
--
-- shipments.packed_at marks a parcel sealed on /admin/pack with every
-- record checked into the box. A packed parcel takes its records off the
-- phone pick list even before it has tracking; the "Box #" written on
-- the mailer is the shipment id. Parcels made on the fulfillment card
-- keep packed_at null and behave as before.
alter table public.orders
  add column if not exists ship_to jsonb;

comment on column public.orders.ship_to is
  'Buyer shipping name and address from PayPal once the invoice is paid: {name, line1, line2, city, state, postal_code, country_code}. Null for off-PayPal sales.';

alter table public.shipments
  add column if not exists packed_at timestamptz;

comment on column public.shipments.packed_at is
  'When the parcel was sealed on /admin/pack with its records checked in. Null = made on the fulfillment card. Packed parcels hide their records from the pick list.';
