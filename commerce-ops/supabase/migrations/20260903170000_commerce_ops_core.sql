create extension if not exists pgcrypto with schema extensions;

create table public.vco_shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  channel text not null check (channel in ('amazon','taobao','pinduoduo','douyin','xiaohongshu','shopify','woocommerce')),
  name text not null check (char_length(name) between 1 and 120),
  connector_status text not null default 'manual_import' check (connector_status in ('manual_import','awaiting_authorization','connected','disabled')),
  created_at timestamptz not null default now(),
  unique(owner_id, channel, name)
);
create table public.vco_imports (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, shop_id uuid not null references public.vco_shops(id) on delete cascade,
  source_name text not null check (char_length(source_name) between 1 and 200), row_count integer not null check (row_count between 0 and 500),
  created_at timestamptz not null default now()
);
create table public.vco_order_lines (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, shop_id uuid not null references public.vco_shops(id) on delete cascade,
  external_order_id text not null, sku text not null, quantity integer not null check(quantity > 0), amount_minor bigint not null check(amount_minor >= 0),
  currency text not null check(currency ~ '^[A-Z]{3}$'), status text not null, occurred_at timestamptz not null, updated_at timestamptz not null default now(),
  unique(shop_id, external_order_id, sku)
);
alter table public.vco_shops enable row level security;
alter table public.vco_imports enable row level security;
alter table public.vco_order_lines enable row level security;
revoke all on public.vco_shops, public.vco_imports, public.vco_order_lines from public, anon, authenticated;
grant select, insert, update, delete on public.vco_shops, public.vco_imports, public.vco_order_lines to service_role;

create or replace function public.vco_import_order_lines(p_owner uuid, p_shop uuid, p_source text, p_rows jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_import uuid; v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_must_be_array'; end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then raise exception 'invalid_row_count'; end if;
  if not exists(select 1 from public.vco_shops where id=p_shop and owner_id=p_owner) then raise exception 'shop_not_found'; end if;
  insert into public.vco_imports(owner_id,shop_id,source_name,row_count) values(p_owner,p_shop,p_source,v_count) returning id into v_import;
  insert into public.vco_order_lines(owner_id,shop_id,external_order_id,sku,quantity,amount_minor,currency,status,occurred_at)
  select p_owner,p_shop,x.external_order_id,x.sku,x.quantity,x.amount_minor,x.currency,x.status,x.occurred_at
  from jsonb_to_recordset(p_rows) as x(external_order_id text,sku text,quantity integer,amount_minor bigint,currency text,status text,occurred_at timestamptz)
  on conflict(shop_id,external_order_id,sku) do update set quantity=excluded.quantity,amount_minor=excluded.amount_minor,currency=excluded.currency,status=excluded.status,occurred_at=excluded.occurred_at,updated_at=now();
  return v_import;
end $$;
revoke all on function public.vco_import_order_lines(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.vco_import_order_lines(uuid,uuid,text,jsonb) to service_role;
