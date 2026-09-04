create or replace function public.vco_order_summary(p_owner uuid)
returns table (
  canonical_status text,
  currency text,
  order_count bigint,
  unit_count bigint,
  amount_minor numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    lines.canonical_status,
    lines.currency,
    count(distinct (lines.shop_id, lines.external_order_id))::bigint as order_count,
    coalesce(sum(lines.quantity), 0)::bigint as unit_count,
    coalesce(sum(lines.amount_minor), 0)::numeric as amount_minor
  from public.vco_order_lines as lines
  where lines.owner_id = p_owner
  group by lines.canonical_status, lines.currency
  order by lines.canonical_status, lines.currency;
$$;

revoke all on function public.vco_order_summary(uuid) from public, anon, authenticated;
grant execute on function public.vco_order_summary(uuid) to service_role;

comment on function public.vco_order_summary(uuid) is
  'Owner-scoped all-row order, unit and imported-amount totals grouped by canonical status and currency.';

-- Rollback: drop function public.vco_order_summary(uuid). No order data is changed.
