create or replace function public.mpl_apply_checkout_event(
  p_event_id text,
  p_checkout_id text,
  p_payment_intent text,
  p_payment_status text,
  p_currency text,
  p_amount_total bigint,
  p_order_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
  settled integer;
begin
  insert into public.mpl_webhook_events (id, event_type)
  values (p_event_id, 'checkout.session.completed')
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return false; end if;

  update public.mpl_orders
  set status = 'paid', stripe_payment_intent = p_payment_intent
  where id = p_order_id
    and stripe_checkout_id = p_checkout_id
    and status = 'pending'
    and currency = lower(p_currency)
    and total_cents = p_amount_total
    and p_payment_status = 'paid'
    and p_payment_intent is not null;
  get diagnostics settled = row_count;
  if settled <> 1 then raise exception 'checkout_settlement_mismatch'; end if;
  return true;
end;
$$;

revoke all on function public.mpl_apply_checkout_event(text,text,text,text,text,bigint,uuid) from public, anon, authenticated;
grant execute on function public.mpl_apply_checkout_event(text,text,text,text,text,bigint,uuid) to service_role;
