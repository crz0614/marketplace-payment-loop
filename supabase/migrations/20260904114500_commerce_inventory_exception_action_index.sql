create index vco_inventory_exception_actions_shop_id_idx
  on public.vco_inventory_exception_actions(shop_id);

-- Rollback: drop index vco_inventory_exception_actions_shop_id_idx.
