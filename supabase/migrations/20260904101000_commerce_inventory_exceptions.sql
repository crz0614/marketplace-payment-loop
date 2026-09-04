create index vco_order_lines_owner_shop_sku_occurred_idx
  on public.vco_order_lines(owner_id, shop_id, sku, occurred_at desc);

create or replace function public.vco_inventory_exceptions(p_owner uuid)
returns table (
  shop_id uuid,
  shop_name text,
  channel text,
  sku text,
  order_line_count bigint,
  ordered_quantity bigint,
  last_order_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    lines.shop_id,
    shops.name as shop_name,
    shops.channel,
    lines.sku,
    count(*)::bigint as order_line_count,
    sum(lines.quantity)::bigint as ordered_quantity,
    max(lines.occurred_at) as last_order_at
  from public.vco_order_lines as lines
  join public.vco_shops as shops
    on shops.id = lines.shop_id and shops.owner_id = p_owner
  left join public.vco_inventory as inventory
    on inventory.owner_id = p_owner
   and inventory.shop_id = lines.shop_id
   and inventory.sku = lines.sku
  where lines.owner_id = p_owner and inventory.id is null
  group by lines.shop_id, shops.name, shops.channel, lines.sku
  order by max(lines.occurred_at) desc, lines.sku
  limit 200;
$$;

revoke all on function public.vco_inventory_exceptions(uuid) from public, anon, authenticated;
grant execute on function public.vco_inventory_exceptions(uuid) to service_role;

comment on function public.vco_inventory_exceptions(uuid) is
  'Owner-scoped order SKUs with no exact inventory record in the same shop, capped at 200 exception groups.';

-- Rollback: drop function public.vco_inventory_exceptions(uuid), then drop
-- index public.vco_order_lines_owner_shop_sku_occurred_idx. Data is unchanged.
