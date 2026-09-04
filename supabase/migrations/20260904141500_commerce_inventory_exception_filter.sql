drop function public.vco_inventory_exceptions(uuid);

create function public.vco_inventory_exceptions(
  p_owner uuid,
  p_action_status text default null
)
returns table (
  shop_id uuid,
  shop_name text,
  channel text,
  sku text,
  order_line_count bigint,
  ordered_quantity bigint,
  last_order_at timestamptz,
  action_status text,
  action_note text,
  action_updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_action_status is not null
     and p_action_status not in ('open', 'investigating', 'ignored') then
    raise exception 'invalid_exception_status';
  end if;

  return query
  select
    lines.shop_id,
    shops.name as shop_name,
    shops.channel,
    lines.sku,
    count(*)::bigint as order_line_count,
    sum(lines.quantity)::bigint as ordered_quantity,
    max(lines.occurred_at) as last_order_at,
    coalesce(actions.status, 'open') as action_status,
    coalesce(actions.note, '') as action_note,
    actions.updated_at as action_updated_at
  from public.vco_order_lines as lines
  join public.vco_shops as shops
    on shops.id = lines.shop_id and shops.owner_id = p_owner
  left join public.vco_inventory as inventory
    on inventory.owner_id = p_owner
   and inventory.shop_id = lines.shop_id
   and inventory.sku = lines.sku
  left join public.vco_inventory_exception_actions as actions
    on actions.owner_id = p_owner
   and actions.shop_id = lines.shop_id
   and actions.sku = lines.sku
  where lines.owner_id = p_owner
    and inventory.id is null
    and (
      p_action_status is null
      or coalesce(actions.status, 'open') = p_action_status
    )
  group by lines.shop_id, shops.name, shops.channel, lines.sku,
           actions.status, actions.note, actions.updated_at
  order by max(lines.occurred_at) desc, lines.sku
  limit 200;
end;
$$;

revoke all on function public.vco_inventory_exceptions(uuid,text)
  from public, anon, authenticated;
grant execute on function public.vco_inventory_exceptions(uuid,text)
  to service_role;

-- Rollback: drop the two-argument function and recreate the previous
-- vco_inventory_exceptions(uuid) implementation before redeploying v22.
