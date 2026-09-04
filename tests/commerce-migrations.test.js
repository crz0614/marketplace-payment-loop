import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');

test('tracked Commerce Ops migrations reproduce the deployed security boundary', () => {
  const core = migration('20260903164749_commerce_ops_core.sql');
  const hardening = migration('20260903164817_commerce_ops_advisor_fixes.sql');
  const canonical = migration('20260904052000_commerce_canonical_status.sql');
  const summary = migration('20260904062000_commerce_order_summary.sql');
  const inventory = migration('20260904075000_commerce_inventory.sql');
  const inventorySummary = migration('20260904081500_commerce_inventory_summary.sql');
  const inventoryExceptions = migration('20260904101000_commerce_inventory_exceptions.sql');
  const inventoryExceptionActions = migration('20260904113000_commerce_inventory_exception_actions.sql');
  const inventoryExceptionActionIndex = migration('20260904114500_commerce_inventory_exception_action_index.sql');

  for (const table of ['vco_shops', 'vco_imports', 'vco_order_lines']) {
    assert.match(core, new RegExp(`create table public\\.${table}`));
    assert.match(core, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  for (const channel of ['amazon', 'taobao', 'pinduoduo', 'douyin', 'xiaohongshu', 'shopify', 'woocommerce']) {
    assert.match(core, new RegExp(`'${channel}'`));
  }
  assert.match(core, /unique \(shop_id, external_order_id, sku\)/);
  assert.match(core, /language plpgsql\s+security invoker\s+set search_path = ''/);
  assert.match(core, /revoke all on function public\.vco_import_order_lines[\s\S]+from public, anon, authenticated/);
  assert.match(core, /grant execute on function public\.vco_import_order_lines[\s\S]+to service_role/);
  assert.match(hardening, /create index vco_imports_shop_id_idx/);
  assert.equal((hardening.match(/using \(false\) with check \(false\)/g) || []).length, 3);
  assert.match(canonical, /add column canonical_status text generated always as/);
  assert.match(canonical, /when '待发货' then 'processing'/);
  assert.match(canonical, /when 'shipped' then 'shipped'/);
  assert.match(canonical, /when '已退款' then 'refunded'/);
  assert.match(canonical, /else 'other'/);
  for (const status of ['pending_payment','processing','shipped','completed','cancelled','refunded','other']) {
    assert.match(canonical, new RegExp(`'${status}'`));
  }
  assert.match(canonical, /create index vco_order_lines_owner_canonical_status_occurred_idx\s+on public\.vco_order_lines\(owner_id, canonical_status, occurred_at desc\)/);
  assert.match(canonical, /Raw status remains intact/);
  assert.match(summary, /create or replace function public\.vco_order_summary\(p_owner uuid\)/);
  assert.match(summary, /count\(distinct \(lines\.shop_id, lines\.external_order_id\)\)/);
  assert.match(summary, /where lines\.owner_id = p_owner/);
  assert.match(summary, /group by lines\.canonical_status, lines\.currency/);
  assert.match(summary, /security invoker\s+set search_path = ''/);
  assert.match(summary, /revoke all on function public\.vco_order_summary\(uuid\) from public, anon, authenticated/);
  assert.match(summary, /grant execute on function public\.vco_order_summary\(uuid\) to service_role/);
  assert.match(inventory, /create table public\.vco_inventory/);
  assert.match(inventory, /is_low_stock boolean generated always as \(available_quantity <= reorder_point\) stored/);
  assert.match(inventory, /unique \(shop_id, sku\)/);
  assert.match(inventory, /alter table public\.vco_inventory enable row level security/);
  assert.match(inventory, /using \(false\) with check \(false\)/);
  assert.match(inventory, /create or replace function public\.vco_upsert_inventory/);
  assert.match(inventory, /language plpgsql\s+security invoker\s+set search_path = ''/);
  assert.match(inventory, /on conflict \(shop_id, sku\) do update/);
  assert.match(inventory, /revoke all on function public\.vco_upsert_inventory[\s\S]+from public, anon, authenticated/);
  assert.match(inventory, /grant execute on function public\.vco_upsert_inventory[\s\S]+to service_role/);
  assert.match(inventorySummary, /create or replace function public\.vco_inventory_summary\(p_owner uuid\)/);
  assert.match(inventorySummary, /where inventory\.owner_id = p_owner/);
  assert.match(inventorySummary, /count\(\*\) filter \(where inventory\.is_low_stock\)/);
  assert.match(inventorySummary, /group by inventory\.sku/);
  assert.match(inventorySummary, /limit 200/);
  assert.match(inventorySummary, /security invoker\s+set search_path = ''/);
  assert.match(inventorySummary, /revoke all on function public\.vco_inventory_summary\(uuid\) from public, anon, authenticated/);
  assert.match(inventorySummary, /grant execute on function public\.vco_inventory_summary\(uuid\) to service_role/);
  assert.match(inventoryExceptions, /create index vco_order_lines_owner_shop_sku_occurred_idx/);
  assert.match(inventoryExceptions, /create or replace function public\.vco_inventory_exceptions\(p_owner uuid\)/);
  assert.match(inventoryExceptions, /left join public\.vco_inventory as inventory/);
  assert.match(inventoryExceptions, /where lines\.owner_id = p_owner and inventory\.id is null/);
  assert.match(inventoryExceptions, /group by lines\.shop_id, shops\.name, shops\.channel, lines\.sku/);
  assert.match(inventoryExceptions, /limit 200/);
  assert.match(inventoryExceptions, /security invoker\s+set search_path = ''/);
  assert.match(inventoryExceptions, /revoke all on function public\.vco_inventory_exceptions\(uuid\) from public, anon, authenticated/);
  assert.match(inventoryExceptions, /grant execute on function public\.vco_inventory_exceptions\(uuid\) to service_role/);
  assert.match(inventoryExceptionActions, /create table public\.vco_inventory_exception_actions/);
  assert.match(inventoryExceptionActions, /unique \(owner_id, shop_id, sku\)/);
  assert.match(inventoryExceptionActions, /status in \('investigating', 'ignored'\)/);
  assert.match(inventoryExceptionActions, /alter table public\.vco_inventory_exception_actions enable row level security/);
  assert.match(inventoryExceptionActions, /using \(false\) with check \(false\)/);
  assert.match(inventoryExceptionActions, /create or replace function public\.vco_set_inventory_exception_action/);
  assert.match(inventoryExceptionActions, /if not exists \([\s\S]+inventory\.id is null/);
  assert.match(inventoryExceptionActions, /on conflict \(owner_id, shop_id, sku\) do update/);
  assert.match(inventoryExceptionActions, /left join public\.vco_inventory_exception_actions as actions/);
  assert.match(inventoryExceptionActions, /coalesce\(actions\.status, 'open'\)/);
  assert.match(inventoryExceptionActions, /security invoker\s+set search_path = ''/);
  assert.match(inventoryExceptionActions, /revoke all on function public\.vco_set_inventory_exception_action[\s\S]+from public, anon, authenticated/);
  assert.match(inventoryExceptionActions, /grant execute on function public\.vco_set_inventory_exception_action[\s\S]+to service_role/);
  assert.match(inventoryExceptionActionIndex, /create index vco_inventory_exception_actions_shop_id_idx\s+on public\.vco_inventory_exception_actions\(shop_id\)/i);
});
