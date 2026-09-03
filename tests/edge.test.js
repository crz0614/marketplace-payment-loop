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
  const query = call => {
    const query = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve, reject) => Promise.resolve(respond(call)).then(resolve, reject);
      return (...args) => { call.operations.push([key, ...args]); return query; };
    }});
    return query;
  };
  const db = {
    from(table) { const call = { table, operations: [] }; calls.push(call); return query(call); },
    rpc(name, args) { const call = { rpc:name, args, operations: [] }; calls.push(call); return query(call); },
  };
  vm.runInNewContext(source, {
    createClient: () => db, Deno: { env: { get: () => '' }, serve: fn => { handler = fn; } },
    crypto, TextEncoder, TextDecoder, Uint8Array, Request, Response, URL, URLSearchParams, AbortSignal,
    console: { error() {} },
  });
  return { calls, handler, request: (path, value, headers = {}) => handler(new Request('https://example.test/marketplace-payment-loop' + path, value === undefined ? {headers} : { method:'POST', body:typeof value === 'string' ? value : JSON.stringify(value), headers:{'content-type':'application/json', ...headers} })) };
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

test('CORS permits only the published frontend and rejects untrusted origins before database access', async () => {
  const app = setup();
  const response = await app.handler(new Request('https://example.test/marketplace-payment-loop/api/login',{method:'OPTIONS',headers:{origin:'https://crz0614.github.io'}}));
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'),'https://crz0614.github.io');
  assert.equal((await app.request('/api/register',{}, {origin:'https://attacker.test'})).status,403);
  assert.equal(app.calls.length,0);
  const allowed = await app.request('/api/health',undefined,{origin:'https://crz0614.github.io'});
  assert.equal(allowed.headers.get('access-control-allow-origin'),'https://crz0614.github.io');
});

test('edge rejects invalid JSON, arrays, null and over-size input before database access', async () => {
  const app = setup();
  for (const input of ['{','[]','null','"scalar"']) assert.equal((await app.request('/api/register',input)).status,400);
  assert.equal((await app.request('/api/register','x'.repeat(65537))).status,413);
  assert.equal((await app.request('/api/register',{}, {'content-type':'text/plain'})).status,415);
  assert.equal((await app.request('/api/register',{email:'test@example.test',password:'x'.repeat(257)})).status,400);
  assert.equal(app.calls.length,0);
});

test('registration creates the user and first session in one database transaction', async () => {
  const app = setup(call => call.rpc === 'mpl_register_user' ? { data:{id:'user-id',email:'a@example.test',role:'member'},error:null } : {error:{message:'unexpected call'}});
  const response = await app.request('/api/register',{email:'a@example.test',password:'long-enough-password'});
  assert.equal(response.status,201);
  assert.equal((await response.json()).user.id,'user-id');
  assert.equal(app.calls.length,1);
  assert.equal(app.calls[0].rpc,'mpl_register_user');
  assert.equal(app.calls[0].args.p_email,'a@example.test');
  assert.equal(app.calls[0].args.p_token_hash.length,64);
  assert.deepEqual(app.calls[0].operations,[['single']]);
});

test('listing search passes filter syntax as data to one restricted RPC', async () => {
  const app = setup();
  const q = 'api),status.eq.paused_%\\"';
  const response = await app.handler(new Request('https://example.test/marketplace-payment-loop/api/listings?q=' + encodeURIComponent(q)));
  assert.equal(response.status,200);
  assert.equal(app.calls.length,1);
  assert.equal(app.calls[0].rpc,'mpl_search_listings');
  assert.equal(app.calls[0].args.p_query,q);
  assert.deepEqual(app.calls[0].operations,[]);
});

test('logout revokes the presented session before reporting success', async () => {
  const app = setup(call => call.table === 'mpl_sessions' && call.operations[0]?.[0] === 'select'
    ? {data:{mpl_users:{id:'user-id',email:'a@example.test',role:'member'}},error:null}
    : {data:null,error:null});
  const response = await app.request('/api/logout',{}, {authorization:'Bearer test-token'});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{signed_out:true});
  assert.equal(app.calls.length,2);
  assert.deepEqual(app.calls[1].operations.map(x => x[0]),['delete','eq']);
  assert.equal(app.calls[1].operations[1][1],'token_hash');
  assert.equal(app.calls[1].operations[1][2].length,64);
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

test('commerce import validates and normalizes rows before one atomic RPC', async () => {
  const app = setup(call => call.table === 'mpl_sessions'
    ? {data:{mpl_users:{id:'user-id',email:'a@example.test',role:'member'}},error:null}
    : call.rpc === 'vco_import_order_lines' ? {data:'import-id',error:null} : {data:null,error:null});
  const response = await app.request('/api/commerce/imports',{shop_id:'shop-id',source_name:'amazon-export.csv',rows:[{
    external_order_id:'AMZ-1',sku:'SKU-1',quantity:2,amount:'19.90',currency:'usd',status:'paid',occurred_at:'2026-09-03T00:00:00Z'
  }]},{authorization:'Bearer test-token'});
  assert.equal(response.status,201);
  assert.deepEqual(await response.json(),{import_id:'import-id',row_count:1});
  const call=app.calls.find(x=>x.rpc==='vco_import_order_lines');
  assert.equal(call.args.p_owner,'user-id');
  assert.equal(call.args.p_rows[0].amount_minor,1990);
  assert.equal(call.args.p_rows[0].currency,'USD');
});

test('commerce import rejects malformed money before database import', async () => {
  const app = setup(call => call.table === 'mpl_sessions' ? {data:{mpl_users:{id:'user-id',role:'member'}},error:null} : {data:null,error:null});
  const response = await app.request('/api/commerce/imports',{shop_id:'shop-id',source_name:'export.csv',rows:[{
    external_order_id:'1',sku:'1',quantity:1,amount:'1.999',currency:'CNY',status:'paid',occurred_at:'2026-09-03'
  }]},{authorization:'Bearer test-token'});
  assert.equal(response.status,400);
  assert.equal(app.calls.some(x=>x.rpc==='vco_import_order_lines'),false);
});
