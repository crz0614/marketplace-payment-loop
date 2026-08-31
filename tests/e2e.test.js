import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../src/store.js';
import { StripeClient } from '../src/stripe.js';
import { createServer } from '../src/server.js';

const fakeFetch = async url => {
  if (url.endsWith('/checkout/sessions')) return new Response(JSON.stringify({id:'cs_test_1',url:'https://checkout.stripe.test/session'}),{status:200});
  if (url.endsWith('/refunds')) return new Response(JSON.stringify({id:'re_test_1',status:'succeeded'}),{status:200});
  return new Response('{}',{status:404});
};
const call = async (base,path,options={}) => {
  const response=await fetch(base+path,{...options,headers:{'content-type':'application/json',...(options.headers||{})}});
  return {response,body:await response.json()};
};

test('registration, listing, search, checkout, signed webhook and refund', async t => {
  const store=new Store(':memory:'),stripe=new StripeClient('sk_test_fake','whsec_test',fakeFetch);
  store.ensureAdmin('admin@example.com','administrator-pass');
  const server=createServer({store,stripe,origin:'http://127.0.0.1'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.close();store.close()});
  const base='http://127.0.0.1:'+server.address().port;
  const home=await fetch(base+'/'),homeBody=await home.text();
  assert.equal(home.status,200);
  assert.match(homeBody,/id="register"/);
  assert.match(homeBody,/id="publish"/);
  assert.match(homeBody,/id="refund"/);
  const seller=await call(base,'/api/register',{method:'POST',body:JSON.stringify({email:'seller@example.com',password:'seller-password'})});
  const sellerCookie=seller.response.headers.get('set-cookie').split(';')[0];
  const listing=await call(base,'/api/listings',{method:'POST',headers:{cookie:sellerCookie},body:JSON.stringify({title:'API integration',description:'Production webhook and CRM integration',price_cents:25000})});
  assert.equal(listing.response.status,201);
  assert.equal((await call(base,'/api/listings?q=webhook')).body.listings.length,1);
  const buyer=await call(base,'/api/register',{method:'POST',body:JSON.stringify({email:'buyer@example.com',password:'buyer-password'})});
  const buyerCookie=buyer.response.headers.get('set-cookie').split(';')[0];
  const checkout=await call(base,'/api/orders',{method:'POST',headers:{cookie:buyerCookie},body:JSON.stringify({listing_id:listing.body.listing.id,quantity:2})});
  assert.equal(checkout.body.checkout_url,'https://checkout.stripe.test/session');
  const event={id:'evt_1',type:'checkout.session.completed',data:{object:{id:'cs_test_1',payment_intent:'pi_test_1'}}};
  const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac('sha256','whsec_test').update(timestamp+'.'+raw).digest('hex');
  const hook=await fetch(base+'/api/webhooks/stripe',{method:'POST',headers:{'stripe-signature':'t='+timestamp+',v1='+signature},body:raw});
  assert.equal(hook.status,200);
  assert.equal((await call(base,'/api/orders',{headers:{cookie:buyerCookie}})).body.orders[0].status,'paid');
  const admin=await call(base,'/api/login',{method:'POST',body:JSON.stringify({email:'admin@example.com',password:'administrator-pass'})});
  const adminCookie=admin.response.headers.get('set-cookie').split(';')[0];
  const refund=await call(base,'/api/admin/refunds',{method:'POST',headers:{cookie:adminCookie},body:JSON.stringify({order_id:checkout.body.order_id})});
  assert.equal(refund.response.status,202);
  assert.equal(refund.body.status,'succeeded');
  const metrics=await fetch(base+'/metrics');
  const metricsBody=await metrics.text();
  assert.equal(metrics.status,200);
  assert.match(metrics.headers.get('content-type'),/text\/plain/);
  assert.match(metricsBody,/marketplace_users_total 3/);
  assert.match(metricsBody,/marketplace_active_listings 1/);
  assert.match(metricsBody,/marketplace_webhook_events_total 1/);
  assert.match(metricsBody,/marketplace_orders\{status="paid"\} 1/);
});

test('rejects self-purchase and invalid webhook signatures', async t => {
  const store=new Store(':memory:'),stripe=new StripeClient('sk','whsec');
  const server=createServer({store,stripe});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.close();store.close()});
  const base='http://127.0.0.1:'+server.address().port;
  const user=await call(base,'/api/register',{method:'POST',body:JSON.stringify({email:'u@example.com',password:'long-password'})});
  const cookie=user.response.headers.get('set-cookie').split(';')[0];
  const listing=await call(base,'/api/listings',{method:'POST',headers:{cookie},body:JSON.stringify({title:'Service',description:'A legitimate technical service',price_cents:5000})});
  const crossOrigin=await call(base,'/api/listings',{method:'POST',headers:{cookie,origin:'https://attacker.example'},body:JSON.stringify({title:'Injected',description:'Cross-site listing attempt',price_cents:5000})});
  assert.equal(crossOrigin.response.status,403);
  assert.equal(crossOrigin.body.error,'origin_not_allowed');
  const order=await call(base,'/api/orders',{method:'POST',headers:{cookie},body:JSON.stringify({listing_id:listing.body.listing.id})});
  assert.equal(order.body.error,'self_purchase');
  assert.equal((await fetch(base+'/api/webhooks/stripe',{method:'POST',headers:{'stripe-signature':'t=1,v1=bad'},body:'{}'})).status,400);
});
