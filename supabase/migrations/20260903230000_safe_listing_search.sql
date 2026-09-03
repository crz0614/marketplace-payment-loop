create or replace function public.mpl_search_listings(p_query text default '')
returns table (
  id uuid,
  title text,
  description text,
  price_cents integer,
  currency text,
  seller_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.id, l.title, l.description, l.price_cents, l.currency, l.seller_id
  from public.mpl_listings as l
  where l.status = 'active'
    and (
      coalesce(p_query, '') = ''
      or position(lower(coalesce(p_query, '')) in lower(l.title)) > 0
      or position(lower(coalesce(p_query, '')) in lower(l.description)) > 0
    )
  order by l.created_at desc
  limit 50;
$$;

revoke all on function public.mpl_search_listings(text) from public, anon, authenticated;
grant execute on function public.mpl_search_listings(text) to service_role;
