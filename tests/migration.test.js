import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260903200000_atomic_checkout_settlement.sql', import.meta.url), 'utf8');
const searchSql = readFileSync(new URL('../supabase/migrations/20260903230000_safe_listing_search.sql', import.meta.url), 'utf8');

test('checkout settlement is one restricted database transaction', () => {
  assert.match(sql,/insert into public\.mpl_webhook_events[\s\S]*on conflict \(id\) do nothing/);
  assert.match(sql,/update public\.mpl_orders[\s\S]*stripe_checkout_id = p_checkout_id[\s\S]*total_cents = p_amount_total[\s\S]*p_payment_status = 'paid'/);
  assert.match(sql,/if settled <> 1 then raise exception/);
  assert.match(sql,/revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(sql,/grant execute[\s\S]*to service_role/);
});

test('listing search is parameterized and restricted to the service role', () => {
  assert.match(searchSql,/security invoker/);
  assert.match(searchSql,/position\(lower\(coalesce\(p_query/);
  assert.match(searchSql,/revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(searchSql,/grant execute[\s\S]*to service_role/);
});
