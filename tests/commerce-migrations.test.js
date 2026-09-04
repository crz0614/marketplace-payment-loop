import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');

test('tracked Commerce Ops migrations reproduce the deployed security boundary', () => {
  const core = migration('20260903164749_commerce_ops_core.sql');
  const hardening = migration('20260903164817_commerce_ops_advisor_fixes.sql');
  const canonical = migration('20260904052000_commerce_canonical_status.sql');
  const summary = migration('20260904062000_commerce_order_summary.sql');

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
});
