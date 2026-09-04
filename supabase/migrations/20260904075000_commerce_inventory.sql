create table public.vco_inventory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.mpl_users(id) on delete cascade,
  shop_id uuid not null references public.vco_shops(id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 120),
  available_quantity integer not null check (available_quantity >= 0),
  reorder_point integer not null check (reorder_point >= 0),
  is_low_stock boolean generated always as (available_quantity <= reorder_point) stored,
  source_name text not null check (char_length(source_name) between 1 and 200),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, sku)
);

create index vco_inventory_owner_low_stock_updated_idx
  on public.vco_inventory(owner_id, is_low_stock, updated_at desc);

alter table public.vco_inventory enable row level security;
create policy "service role only" on public.vco_inventory
  for all to public using (false) with check (false);

revoke all on table public.vco_inventory from public, anon, authenticated;
grant select, insert, update, delete on table public.vco_inventory to service_role;

create or replace function public.vco_upsert_inventory(
  p_owner uuid,
  p_shop uuid,
  p_source text,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if not exists (
    select 1 from public.vco_shops
    where id = p_shop and owner_id = p_owner
  ) then
    raise exception 'shop_not_found';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) not between 1 and 100
     or p_source is null
     or char_length(trim(p_source)) not between 1 and 200 then
    raise exception 'invalid_inventory';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item
    where jsonb_typeof(item) <> 'object'
       or coalesce(char_length(trim(item->>'sku')), 0) not between 1 and 120
       or coalesce(item->>'available_quantity', '') !~ '^\d{1,10}$'
       or coalesce(item->>'reorder_point', '') !~ '^\d{1,10}$'
       or (item->>'available_quantity')::numeric > 2147483647
       or (item->>'reorder_point')::numeric > 2147483647
  ) or (
    select count(*) <> count(distinct trim(item->>'sku'))
    from jsonb_array_elements(p_rows) as item
  ) then
    raise exception 'invalid_inventory';
  end if;

  insert into public.vco_inventory (
    owner_id, shop_id, sku, available_quantity, reorder_point, source_name, captured_at, updated_at
  )
  select
    p_owner,
    p_shop,
    trim(item->>'sku'),
    (item->>'available_quantity')::integer,
    (item->>'reorder_point')::integer,
    trim(p_source),
    now(),
    now()
  from jsonb_array_elements(p_rows) as item
  on conflict (shop_id, sku) do update set
    owner_id = excluded.owner_id,
    available_quantity = excluded.available_quantity,
    reorder_point = excluded.reorder_point,
    source_name = excluded.source_name,
    captured_at = excluded.captured_at,
    updated_at = excluded.updated_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.vco_upsert_inventory(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.vco_upsert_inventory(uuid, uuid, text, jsonb) to service_role;

comment on table public.vco_inventory is
  'Latest owner-scoped inventory position per shop and SKU, imported from an official platform export.';
comment on function public.vco_upsert_inventory(uuid, uuid, text, jsonb) is
  'Atomically validates and upserts up to 100 inventory rows for an owner-scoped shop.';

-- Rollback: deploy the previous Edge Function, export this table, verify zero business rows,
-- then drop vco_upsert_inventory(uuid,uuid,text,jsonb) and vco_inventory.
