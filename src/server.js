import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Store } from './store.js';
import { StripeClient } from './stripe.js';

const here = dirname(fileURLToPath(import.meta.url));
const send = (res, status, value, headers = {}) => { res.writeHead(status, { 'content-type':'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value)); };
const readBody = async req => {
  const chunks=[]; let size=0;
  for await (const chunk of req) { size += chunk.length; if (size > 1000000) throw new Error('body_too_large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
};
const cookieMap = req => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(x => x.trim().split('=').map(decodeURIComponent)));
const sessionCookie = (token, expires) => 'session=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Expires=' + new Date(expires).toUTCString() + (process.env.NODE_ENV === 'production' ? '; Secure' : '');

export function createServer({ store, stripe, origin = 'http://localhost:3000' }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, origin), method = req.method || 'GET';
    try {
      if (!['GET','HEAD','OPTIONS'].includes(method) && url.pathname !== '/api/webhooks/stripe' && req.headers.origin && req.headers.origin !== origin) {
        return send(res,403,{error:'origin_not_allowed'});
      }
      if (method === 'GET' && url.pathname === '/') {
        const page = await readFile(join(here, '../public/index.html'));
        res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(page);
      }
      if (method === 'GET' && url.pathname === '/api/health') return send(res,200,{status:'ok',database:'sqlite',stripe:stripe.configured(),time:new Date().toISOString()});
      if (method === 'GET' && url.pathname === '/api/listings') return send(res,200,{listings:store.listings(url.searchParams.get('q') || '')});
      if (method === 'POST' && url.pathname === '/api/webhooks/stripe') {
        const raw=await readBody(req), event=stripe.verify(raw,req.headers['stripe-signature']);
        return send(res,200,{received:true,applied:store.applyStripeEvent(event)});
      }
      if (method === 'POST' && url.pathname === '/api/register') {
        const input=JSON.parse(await readBody(req)), user=store.createUser(input.email,input.password), session=store.createSession(user.id);
        return send(res,201,{user},{'set-cookie':sessionCookie(session.token,session.expires)});
      }
      if (method === 'POST' && url.pathname === '/api/login') {
        const input=JSON.parse(await readBody(req)), user=store.authenticate(input.email,input.password);
        if(!user) return send(res,401,{error:'invalid_credentials'});
        const session=store.createSession(user.id); return send(res,200,{user},{'set-cookie':sessionCookie(session.token,session.expires)});
      }
      if (method === 'POST' && url.pathname === '/api/logout') {
        const token=cookieMap(req).session; if(token) store.deleteSession(token);
        return send(res,200,{ok:true},{'set-cookie':'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'});
      }
      const user=store.session(cookieMap(req).session);
      if(!user) return send(res,401,{error:'authentication_required'});
      if(method==='GET' && url.pathname==='/api/me') return send(res,200,{user});
      if(method==='POST' && url.pathname==='/api/listings') return send(res,201,{listing:store.createListing(user.id,JSON.parse(await readBody(req)))});
      if(method==='GET' && url.pathname==='/api/orders') return send(res,200,{orders:store.orders(user)});
      if(method==='POST' && url.pathname==='/api/orders') {
        const input=JSON.parse(await readBody(req)), order=store.createOrder(user.id,input.listing_id,Number(input.quantity||1));
        try { const session=await stripe.createCheckout(order,origin); store.attachCheckout(order.id,session.id); return send(res,201,{order_id:order.id,checkout_url:session.url}); }
        catch(error) { store.failCheckout(order.id); return send(res,503,{error:'checkout_unavailable',detail:error.message}); }
      }
      if(method==='POST' && url.pathname==='/api/admin/refunds') {
        if(user.role!=='admin') return send(res,403,{error:'admin_required'});
        const input=JSON.parse(await readBody(req)), order=store.order(input.order_id,user);
        if(!order?.stripe_payment_intent || order.status!=='paid') return send(res,409,{error:'order_not_refundable'});
        const refund=await stripe.refund(order.stripe_payment_intent,input.amount_cents); return send(res,202,{refund_id:refund.id,status:refund.status});
      }
      return send(res,404,{error:'not_found'});
    } catch(error) { return send(res,error.message==='body_too_large'?413:400,{error:error.message}); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store=new Store(process.env.DATABASE_PATH || './data/marketplace.sqlite');
  store.ensureAdmin(process.env.ADMIN_EMAIL,process.env.ADMIN_PASSWORD);
  const stripe=new StripeClient(process.env.STRIPE_SECRET_KEY,process.env.STRIPE_WEBHOOK_SECRET);
  const port=Number(process.env.PORT||3000),origin=process.env.APP_ORIGIN || 'http://localhost:' + port;
  const server=createServer({store,stripe,origin});
  server.listen(port,()=>console.log('marketplace listening on ' + origin));
  const stop=()=>server.close(()=>{store.close();process.exit(0)});
  process.on('SIGTERM',stop); process.on('SIGINT',stop);
}
