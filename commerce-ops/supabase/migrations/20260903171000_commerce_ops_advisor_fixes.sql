create index vco_imports_shop_id_idx on public.vco_imports(shop_id);

create policy "deny direct shop access" on public.vco_shops for all using (false) with check (false);
create policy "deny direct import access" on public.vco_imports for all using (false) with check (false);
create policy "deny direct order access" on public.vco_order_lines for all using (false) with check (false);
