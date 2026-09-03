import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = name => readFileSync(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');

test('tracked Commerce Ops migrations reproduce the deployed security boundary', () => {
  const core = migration('20260903164749_commerce_ops_core.sql');
  const hardening = migration('20260903164817_commerce_ops_advisor_fixes.sql');

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
});
