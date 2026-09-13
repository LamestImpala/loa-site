-- Pending invoices: an invoice becomes a durable "order in progress" the
-- moment it's created, so the admin can clear the sale desk and still
-- find the payment link, check whether it's paid, or cancel it.
alter table public.invoices
  add column if not exists buyer_username text,
  add column if not exists recipient_view_url text,
  add column if not exists status text,          -- PayPal status: DRAFT / SENT / PAID / CANCELLED …
  add column if not exists record_ids integer[],
  add column if not exists total numeric,
  add column if not exists cancelled_at timestamptz;

-- Backfill invoices that are already out on unsold records so they show
-- up as pending right away. Their payment link is filled in by the first
-- "Check PayPal" from the admin.
insert into public.invoices (paypal_invoice_id, buyer_username, record_ids, status)
select
  paypal_invoice_id,
  max(hold_buyer),
  array_agg(id order by id),
  'SENT'
from public.records
where paypal_invoice_id is not null and not sold
group by paypal_invoice_id
on conflict (paypal_invoice_id) do update set
  record_ids = excluded.record_ids,
  buyer_username = coalesce(public.invoices.buyer_username, excluded.buyer_username),
  status = coalesce(public.invoices.status, excluded.status),
  updated_at = now();
