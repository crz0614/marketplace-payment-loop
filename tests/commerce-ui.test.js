import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../public/commerce.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('commerce UI JavaScript parses and covers every requested channel',()=>{
  assert.doesNotThrow(()=>new vm.Script(script));
  for(const channel of ['amazon','taobao','pinduoduo','douyin','xiaohongshu']) assert.match(script,new RegExp(channel));
});
test('commerce UI provides persisted Chinese and English copy',()=>{
  assert.match(script,/localStorage\.getItem\('vco_lang'\)/);
  assert.match(script,/copy=\{zh:\{/);
  assert.match(script,/,en:\{/);
  assert.match(html,/id="language"/);
  assert.match(script,/orderId:'订单号'/);
  assert.match(script,/orderId:'Order'/);
  assert.match(script,/errorText=code/);
  assert.match(script,/authentication_required:'请先登录。'/);
});
test('commerce UI connects all operational controls to the authenticated API',()=>{
  for(const route of ['/api/commerce/shops','/api/commerce/imports','/api/commerce/orders']) assert.match(script,new RegExp(route));
  assert.match(script,/authorization:'Bearer '\+token/);
  assert.match(html,/id="csvFile"/);
  assert.match(html,/id="refreshImports"/);
  assert.match(script,/async function imports\(\)/);
  assert.match(script,/importHistory:'导入记录'/);
  assert.match(script,/importHistory:'Import history'/);
  assert.match(script,/shop:'店铺'/);
  assert.match(script,/shop:'Shop'/);
  assert.match(script,/x\.shop\.name/);
  assert.match(script,/async function orders\(\).*?x\.shop\?esc\(x\.shop\.name\)/);
  assert.match(html,/id="orderShop"/);
  assert.match(script,/allShops:'全部店铺'/);
  assert.match(script,/allShops:'All shops'/);
  assert.match(script,/shop_id='\+encodeURIComponent\(shop\)/);
});
test('commerce UI rejects unsafe import sizes and duplicate field mappings before the API call',()=>{
  assert.match(script,/file\.size>32768/);
  assert.match(script,/csvRows\.length>100/);
  assert.match(script,/new Set\(mapped\)\.size!==mapped\.length/);
  for(const code of ['file_too_large','too_many_rows','duplicate_mapping','body_too_large']){
    assert.match(script,new RegExp(code));
  }
});
