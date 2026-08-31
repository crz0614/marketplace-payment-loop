create index if not exists mpl_sessions_user_idx on public.mpl_sessions(user_id);
create index if not exists mpl_listings_seller_idx on public.mpl_listings(seller_id);
create index if not exists mpl_orders_listing_idx on public.mpl_orders(listing_id);
create index if not exists mpl_orders_seller_idx on public.mpl_orders(seller_id, created_at desc);

create policy "deny direct access to marketplace users" on public.mpl_users for all to anon, authenticated using (false) with check (false);
create policy "deny direct access to marketplace sessions" on public.mpl_sessions for all to anon, authenticated using (false) with check (false);
create policy "deny direct access to marketplace listings" on public.mpl_listings for all to anon, authenticated using (false) with check (false);
create policy "deny direct access to marketplace orders" on public.mpl_orders for all to anon, authenticated using (false) with check (false);
create policy "deny direct access to marketplace webhooks" on public.mpl_webhook_events for all to anon, authenticated using (false) with check (false);
