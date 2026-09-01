import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Execute the actual deployed handler; only the database transport is replaced.
const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/marketplace-payment-loop/index.ts', import.meta.url), 'utf8').replace(/^import .*\n/, ''));
function setup(respond = () => ({ data: [], error: null })) {
  let handler;
  const calls = [];
  const db = { from(table) {
    const call = { table, operations: [] }; calls.push(call);
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject);
      return (...args) => { call.operations.push([key, ...args]); return query; };
    }});
    return query;
  }};
  vm.runInNewContext(source, {
    createClient: () => db, Deno: { env: { get: () => '' }, serve: fn => { handler = fn; } },
    crypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL, URLSearchParams, AbortSignal,
    console: { error() {} },
  });
  return { calls, request: (path, value, headers = {}) => handler(new Request('https://example.test/marketplace-payment-loop' + path, value === undefined ? {} : { method:'POST', body:typeof value === 'string' ? value : JSON.stringify(value), headers:{'content-type':'application/json', ...headers} })) };
}

test('edge health probes database and reports failures without leaking errors', async () => {
  const app = setup(() => ({ error: { message:'private database detail' } }));
  const response = await app.request('/api/health');
  assert.equal(response.status,503);
  const data = await response.json();
  assert.equal(data.database_ready,false);
  assert.equal(data.stripe,false);
  assert.equal(app.calls[0].table,'mpl_listings');
  assert.ok(!JSON.stringify(data).includes('private'));
});

test('edge payment gates perform no database writes', async () => {
  const app = setup();
  for (const path of ['/api/orders','/api/webhooks/stripe','/api/refunds']) {
    assert.equal((await app.request(path,{})).status,503);
  }
  assert.equal(app.calls.length,0);
});

test('served browser JavaScript parses successfully', async () => {
  const html = await (await setup().request('/')).text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});

test('edge rejects invalid JSON, arrays, null and over-size input before database access', async () => {
  const app = setup();
  for (const input of ['{','[]','null','"scalar"']) assert.equal((await app.request('/api/register',input)).status,400);
  assert.equal((await app.request('/api/register','x'.repeat(65537))).status,413);
  assert.equal((await app.request('/api/register',{}, {'content-type':'text/plain'})).status,415);
  assert.equal((await app.request('/api/register',{email:'test@example.test',password:'x'.repeat(257)})).status,400);
  assert.equal(app.calls.length,0);
});

test('registration never returns a token when session persistence fails', async () => {
  const app = setup(call => call.table === 'mpl_users' ? { data:{id:'user-id',email:'a@example.test',role:'user'},error:null } : {error:{message:'session failure'}});
  const response = await app.request('/api/register',{email:'a@example.test',password:'long-enough-password'});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'session_unavailable'});
});

test('session database outage is not misreported as invalid credentials', async () => {
  const app = setup(() => ({error:{message:'secret query'}}));
  const response = await app.request('/api/listings',{title:'Valid title',description:'Valid description',price_cents:100},{authorization:'Bearer test-token'});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'session_unavailable'});
});

test('listing price and text validation prevents writes', async () => {
  const app = setup(() => ({data:{mpl_users:{id:'user-id',role:'user'}},error:null}));
  for (const price of [0,49,1.5,'100',null,10000001]) {
    assert.equal((await app.request('/api/listings',{title:'Valid title',description:'Valid description',price_cents:price},{authorization:'Bearer test-token'})).status,400);
  }
  assert.ok(app.calls.every(call => call.table === 'mpl_sessions'));
});
