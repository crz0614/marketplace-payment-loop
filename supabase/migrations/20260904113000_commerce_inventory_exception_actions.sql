create table public.vco_inventory_exception_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.mpl_users(id) on delete cascade,
  shop_id uuid not null references public.vco_shops(id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 120),
  status text not null check (status in ('investigating', 'ignored')),
  note text not null default '' check (char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  unique (owner_id, shop_id, sku)
);

alter table public.vco_inventory_exception_actions enable row level security;
create policy "service role only" on public.vco_inventory_exception_actions
  for all to public using (false) with check (false);

revoke all on table public.vco_inventory_exception_actions from public, anon, authenticated;
grant select, insert, update, delete on table public.vco_inventory_exception_actions to service_role;

create or replace function public.vco_set_inventory_exception_action(
  p_owner uuid,
  p_shop uuid,
  p_sku text,
  p_status text,
  p_note text
)
returns table (action_status text, action_note text, action_updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('open', 'investigating', 'ignored')
     or p_sku is null or char_length(p_sku) not between 1 and 120
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid_exception_action';
  end if;

  if not exists (
    select 1
    from public.vco_order_lines as lines
    join public.vco_shops as shops
      on shops.id = lines.shop_id and shops.owner_id = p_owner
    left join public.vco_inventory as inventory
      on inventory.owner_id = p_owner
     and inventory.shop_id = lines.shop_id
     and inventory.sku = lines.sku
    where lines.owner_id = p_owner
      and lines.shop_id = p_shop
      and lines.sku = p_sku
      and inventory.id is null
  ) then
    raise exception 'exception_not_found';
  end if;

  if p_status = 'open' then
    delete from public.vco_inventory_exception_actions as actions
    where actions.owner_id = p_owner and actions.shop_id = p_shop and actions.sku = p_sku;
    return query select 'open'::text, ''::text, now();
    return;
  end if;

  return query
  insert into public.vco_inventory_exception_actions as actions
    (owner_id, shop_id, sku, status, note, updated_at)
  values (p_owner, p_shop, p_sku, p_status, coalesce(p_note, ''), now())
  on conflict (owner_id, shop_id, sku) do update
    set status = excluded.status, note = excluded.note, updated_at = excluded.updated_at
  returning actions.status, actions.note, actions.updated_at;
end;
$$;

revoke all on function public.vco_set_inventory_exception_action(uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.vco_set_inventory_exception_action(uuid,uuid,text,text,text)
  to service_role;

drop function public.vco_inventory_exceptions(uuid);
create function public.vco_inventory_exceptions(p_owner uuid)
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
  where lines.owner_id = p_owner and inventory.id is null
  group by lines.shop_id, shops.name, shops.channel, lines.sku,
           actions.status, actions.note, actions.updated_at
  order by max(lines.occurred_at) desc, lines.sku
  limit 200;
$$;

revoke all on function public.vco_inventory_exceptions(uuid) from public, anon, authenticated;
grant execute on function public.vco_inventory_exceptions(uuid) to service_role;

comment on table public.vco_inventory_exception_actions is
  'Owner-scoped investigation state for exact shop/SKU order-inventory exceptions.';

-- Rollback: deploy the previous Edge Function, export any notes that must be
-- retained, drop vco_set_inventory_exception_action(uuid,uuid,text,text,text),
-- recreate the prior vco_inventory_exceptions(uuid), then drop this table.
