create or replace function public.vco_inventory_summary(p_owner uuid)
returns table (
  sku text,
  shop_count bigint,
  low_stock_shop_count bigint,
  available_quantity bigint,
  reorder_point bigint,
  latest_capture timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    inventory.sku,
    count(*)::bigint as shop_count,
    count(*) filter (where inventory.is_low_stock)::bigint as low_stock_shop_count,
    sum(inventory.available_quantity)::bigint as available_quantity,
    sum(inventory.reorder_point)::bigint as reorder_point,
    max(inventory.captured_at) as latest_capture
  from public.vco_inventory as inventory
  where inventory.owner_id = p_owner
  group by inventory.sku
  order by count(*) filter (where inventory.is_low_stock) desc, inventory.sku
  limit 200;
$$;

revoke all on function public.vco_inventory_summary(uuid) from public, anon, authenticated;
grant execute on function public.vco_inventory_summary(uuid) to service_role;

comment on function public.vco_inventory_summary(uuid) is
  'Owner-scoped exact-SKU totals and low-stock shop counts across up to 200 SKUs.';

-- Rollback: drop function public.vco_inventory_summary(uuid). Inventory is unchanged.
