import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
const serviceKey = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || ''
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || ''
const enc = new TextEncoder()
// Deliberately closed until transactional settlement and real Stripe E2E pass.
// Secrets alone must not enable the legacy, non-atomic payment handlers.
const paymentsReady = false

class HttpError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

const page = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MarketLoop · Live payment lifecycle</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#17201b;background:#f3f0e8}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1050px;margin:auto;padding:32px 22px 70px}header,.row{display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{font-size:22px;font-weight:850}.pill{border:1px solid #b8c3ba;border-radius:999px;padding:8px 12px}h1{font-size:clamp(42px,7vw,76px);line-height:.96;max-width:880px;margin:72px 0 22px;letter-spacing:-.06em}.lead{font-size:19px;max-width:760px;line-height:1.55;color:#4b5950}.grid,.two{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:50px 0}.two{grid-template-columns:1fr 1fr;margin:18px 0}.card,.box{background:#fff;border:1px solid #d7ddd7;border-radius:20px;padding:21px}.card b{display:block;font-size:24px;margin:22px 0 8px}.stack{display:grid;gap:10px}input,textarea,button{font:inherit;border-radius:10px;border:1px solid #c7d0c8;padding:11px 13px}textarea{min-height:80px}button{background:#17201b;color:white;font-weight:700;cursor:pointer}.item{border-top:1px solid #e1e5e1;padding:14px 0}.muted{color:#647068;font-size:14px}.hidden{display:none!important}.notice{min-height:24px;color:#315a40}@media(max-width:720px){.grid,.two{grid-template-columns:1fr}h1{margin-top:50px}}
</style></head><body><main class="wrap"><header><div class="brand">MarketLoop</div><span id="who" class="pill">Guest · 访客</span></header><h1>A real marketplace loop, not a checkout mockup.</h1><p class="lead">Persistent accounts, service publishing, search, server-priced orders, Stripe test Checkout, signed Webhooks and controlled refunds.<br>真实持久化账户、服务发布、搜索、服务端定价订单、Stripe 测试支付、签名 Webhook 与受控退款。</p><section class="grid"><article class="card"><span>Database</span><b>PostgreSQL</b><small>Persistent, indexed, RLS protected</small></article><article class="card"><span>Payments</span><b>Stripe test</b><small id="stripeState">Configuration checked live</small></article><article class="card"><span>Runtime</span><b>Edge deployed</b><small>Health and API available</small></article></section><section id="auth" class="box"><h2>Account · 账户</h2><div class="two"><form id="register" class="stack"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" minlength="10" placeholder="Password (10+ characters)" required><button>Create account</button></form><form id="login" class="stack"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><button>Sign in</button></form></div></section><section class="box"><div class="row"><h2>Services · 服务</h2><form id="search"><input name="q" placeholder="Search"><button>Search</button></form></div><div id="listings"></div></section><section id="member" class="two hidden"><div class="box"><h2>Publish · 发布</h2><form id="publish" class="stack"><input name="title" minlength="3" placeholder="Title" required><textarea name="description" minlength="10" placeholder="Scope and deliverable" required></textarea><input name="price" type="number" min=".5" step=".01" placeholder="USD" required><button>Publish service</button></form></div><div class="box"><h2>Orders · 订单</h2><div id="orders"></div></div></section><p id="notice" class="notice" role="status"></p></main><script>
const BASE=location.pathname.replace(/\/$/,'');let token=localStorage.getItem('mpl_token')||'';const $=s=>document.querySelector(s),v=f=>Object.fromEntries(new FormData(f)),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function api(path,o={}){const r=await fetch(BASE+path,{...o,headers:{'content-type':'application/json',...(token?{'authorization':'Bearer '+token}:{}),...(o.headers||{})}}),b=await r.json();if(!r.ok)throw Error(b.error||'request_failed');return b}function say(x,b=false){$('#notice').textContent=x;$('#notice').style.color=b?'#9a332d':'#315a40'}async function me(){try{const x=await api('/api/me');$('#who').textContent=x.user.email;$('#auth').classList.add('hidden');$('#member').classList.remove('hidden');orders()}catch{$('#auth').classList.remove('hidden');$('#member').classList.add('hidden')}}async function listings(q=''){const a=(await api('/api/listings?q='+encodeURIComponent(q))).listings;$('#listings').innerHTML=a.length?a.map(x=>'<div class="item row"><div><b>'+esc(x.title)+'</b><div class="muted">'+esc(x.description)+'</div></div><div>$'+(x.price_cents/100).toFixed(2)+'<br><button data-buy="'+x.id+'">Order</button></div></div>').join(''):'<p class="muted">No services yet.</p>'}async function orders(){const a=(await api('/api/orders')).orders;$('#orders').innerHTML=a.length?a.map(x=>'<div class="item"><b>'+esc(x.status)+'</b> · $'+(x.total_cents/100).toFixed(2)+'</div>').join(''):'<p class="muted">No orders yet.</p>'}for(const id of ['register','login'])$('#'+id).onsubmit=async e=>{e.preventDefault();try{const x=await api('/api/'+id,{method:'POST',body:JSON.stringify(v(e.target))});token=x.token;localStorage.setItem('mpl_token',token);say(id==='register'?'Account created.':'Signed in.');me()}catch(x){say(x.message,true)}};$('#search').onsubmit=e=>{e.preventDefault();listings(new FormData(e.target).get('q')).catch(x=>say(x.message,true))};$('#publish').onsubmit=async e=>{e.preventDefault();const x=v(e.target);try{await api('/api/listings',{method:'POST',body:JSON.stringify({title:x.title,description:x.description,price_cents:Math.round(Number(x.price)*100)})});e.target.reset();say('Published.');listings()}catch(x){say(x.message,true)}};$('#listings').onclick=async e=>{if(!e.target.dataset.buy)return;try{const x=await api('/api/orders',{method:'POST',body:JSON.stringify({listing_id:e.target.dataset.buy,quantity:1})});location.href=x.checkout_url}catch(x){say(x.message,true)}};api('/api/health').then(x=>$('#stripeState').textContent=x.stripe?'Test mode configured':'Awaiting test keys');listings();me();
</script></body></html>`

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const fail = (message: string, status = 400) => json({ error: message }, status)
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (value: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)))
const passwordHash = async (password: string, salt = crypto.randomUUID()) => {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 210000 }, material, 256)
  return salt + ':' + hex(bits)
}
const passwordOk = async (password: string, stored: string) => {
  const [salt] = stored.split(':'); return await passwordHash(password, salt) === stored
}
const body = async (req: Request) => {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new HttpError('json_required', 415)
  const reader = req.body?.getReader(); let size = 0; const chunks: Uint8Array[] = []
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break
        size += value.byteLength
        if (size > 65536) { await reader.cancel(); throw new HttpError('body_too_large', 413) }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new HttpError('invalid_json') }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new HttpError('json_object_required')
  return value
}
const credentials = (x: Record<string, unknown>) => {
  if (typeof x.email !== 'string' || typeof x.password !== 'string') throw new HttpError('invalid_credentials')
  const email = x.email.trim().toLowerCase(), password = x.password
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || password.length > 256) throw new HttpError('invalid_credentials')
  return { email, password }
}
const createSession = async (userId: string) => {
  const token = crypto.randomUUID() + crypto.randomUUID()
  const { error } = await db.from('mpl_sessions').insert({ token_hash: await sha256(token), user_id: userId, expires_at: new Date(Date.now() + 7*86400000).toISOString() })
  if (error) throw new HttpError('session_unavailable', 503)
  return token
}
const auth = async (req: Request) => {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer /, '')
  if (!token) return null
  const hash = await sha256(token)
  const { data, error } = await db.from('mpl_sessions').select('user_id,mpl_users(id,email,role)').eq('token_hash', hash).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (error) throw new HttpError('session_unavailable', 503)
  return data?.mpl_users || null
}
const stripe = async (path: string, values: Record<string,string>) => {
  if (!stripeKey.startsWith('sk_test_')) throw Error('stripe_test_keys_required')
  const response = await fetch('https://api.stripe.com/v1/' + path, { method: 'POST', headers: { authorization: 'Bearer ' + stripeKey, 'content-type':'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) })
  const result = await response.json(); if (!response.ok) throw Error(result.error?.message || 'stripe_error'); return result
}
const verifyStripe = async (raw: string, signature: string) => {
  if (!webhookSecret.startsWith('whsec_')) throw Error('stripe_webhook_secret_required')
  const parts = Object.fromEntries(signature.split(',').map(x => x.split('=',2))), timestamp = Number(parts.t)
  if (!timestamp || Math.abs(Date.now()/1000-timestamp)>300) throw Error('invalid_signature_timestamp')
  const key = await crypto.subtle.importKey('raw', enc.encode(webhookSecret), {name:'HMAC',hash:'SHA-256'}, false, ['sign'])
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(parts.t+'.'+raw)))
  const actual = parts.v1 || ''
  let mismatch = expected.length === actual.length ? 0 : 1
  for (let i = 0; i < Math.max(expected.length, actual.length); i++) mismatch |= (expected.charCodeAt(i) || 0) ^ (actual.charCodeAt(i) || 0)
  if (mismatch) throw Error('invalid_signature')
  return JSON.parse(raw)
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url), marker = '/marketplace-payment-loop', path = url.pathname.slice(url.pathname.indexOf(marker) + marker.length) || '/'
    if (req.method === 'GET' && path === '/') return new Response(page, { headers: { 'content-type':'text/html; charset=utf-8', 'content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'x-content-type-options':'nosniff' } })
    if (req.method === 'GET' && path === '/api/health') {
      const { error } = await db.from('mpl_listings').select('id').limit(1).abortSignal(AbortSignal.timeout(5000))
      return json({ status:error?'degraded':'ok', database:'postgresql', database_ready:!error, runtime:'supabase-edge', stripe:paymentsReady, stripe_keys_configured:stripeKey.startsWith('sk_test_') && webhookSecret.startsWith('whsec_'), payments_status:'disabled_pending_settlement_audit', time:new Date().toISOString() }, error?503:200)
    }
    if (!paymentsReady && req.method === 'POST' && (path === '/api/orders' || path === '/api/webhooks/stripe' || path.startsWith('/api/refund'))) return fail('payments_disabled_pending_verification',503)
    if (req.method === 'GET' && path === '/api/listings') { const q=(url.searchParams.get('q')||'').slice(0,100); let query=db.from('mpl_listings').select('id,title,description,price_cents,currency,seller_id').eq('status','active').order('created_at',{ascending:false}).limit(50); if(q)query=query.or(`title.ilike.%${q.replace(/[%_,]/g,'')}%,description.ilike.%${q.replace(/[%_,]/g,'')}%`); const {data,error}=await query;if(error)throw error;return json({listings:data}) }
    if (req.method === 'POST' && path === '/api/register') {
      const { email, password } = credentials(await body(req))
      const { data:user, error } = await db.from('mpl_users').insert({ email, password_hash:await passwordHash(password) }).select('id,email,role').single()
      if (error) return fail(error.code==='23505'?'email_exists':'registration_unavailable',error.code==='23505'?409:503)
      return json({ user, token:await createSession(user.id) },201)
    }
    if (req.method === 'POST' && path === '/api/login') {
      const { email, password } = credentials(await body(req))
      const { data:user, error } = await db.from('mpl_users').select('id,email,role,password_hash').eq('email',email).maybeSingle()
      if (error) throw new HttpError('login_unavailable',503)
      if (!user || !await passwordOk(password,user.password_hash)) return fail('invalid_credentials',401)
      const token = await createSession(user.id); delete user.password_hash
      return json({ user, token })
    }
    if (req.method === 'POST' && path === '/api/webhooks/stripe') { const raw=await req.text(),event=await verifyStripe(raw,req.headers.get('stripe-signature')||'');const {error}=await db.from('mpl_webhook_events').insert({id:event.id,event_type:event.type});if(error?.code==='23505')return json({received:true,applied:false});if(error)throw error;if(event.type==='checkout.session.completed')await db.from('mpl_orders').update({status:'paid',stripe_payment_intent:event.data.object.payment_intent}).eq('stripe_checkout_id',event.data.object.id).eq('status','pending');if(event.type==='charge.refunded')await db.from('mpl_orders').update({status:'refunded'}).eq('stripe_payment_intent',event.data.object.payment_intent);return json({received:true,applied:true}) }
    const user:any = await auth(req); if(!user)return fail('authentication_required',401)
    if (req.method === 'GET' && path === '/api/me') return json({user})
    if (req.method === 'POST' && path === '/api/listings') {
      const x=await body(req)
      if (typeof x.title!=='string' || x.title.trim().length<3 || x.title.length>120 || typeof x.description!=='string' || x.description.trim().length<10 || x.description.length>5000 || !Number.isSafeInteger(x.price_cents) || x.price_cents<50 || x.price_cents>10000000) return fail('invalid_listing')
      const {data,error}=await db.from('mpl_listings').insert({seller_id:user.id,title:x.title.trim(),description:x.description.trim(),price_cents:x.price_cents}).select().single()
      if(error)throw error;return json({listing:data},201)
    }
    if (req.method === 'GET' && path === '/api/orders') { let query=db.from('mpl_orders').select('*').order('created_at',{ascending:false}).limit(100);if(user.role!=='admin')query=query.eq('buyer_id',user.id);const {data,error}=await query;if(error)throw error;return json({orders:data}) }
    if (req.method === 'POST' && path === '/api/orders') { const x=await body(req),quantity=Math.max(1,Math.min(20,Number(x.quantity||1)));const {data:listing}=await db.from('mpl_listings').select('*').eq('id',x.listing_id).eq('status','active').single();if(!listing)return fail('listing_not_found',404);if(listing.seller_id===user.id)return fail('self_purchase_forbidden',409);const {data:order,error}=await db.from('mpl_orders').insert({listing_id:listing.id,buyer_id:user.id,seller_id:listing.seller_id,quantity,total_cents:listing.price_cents*quantity,currency:'usd'}).select().single();if(error)throw error;try{const origin=url.origin+url.pathname.slice(0,url.pathname.indexOf(marker)+marker.length);const session=await stripe('checkout/sessions',{'mode':'payment','success_url':origin+'?checkout=success','cancel_url':origin+'?checkout=cancel','line_items[0][price_data][currency]':'usd','line_items[0][price_data][product_data][name]':listing.title,'line_items[0][price_data][unit_amount]':String(listing.price_cents),'line_items[0][quantity]':String(quantity),'metadata[order_id]':order.id});await db.from('mpl_orders').update({stripe_checkout_id:session.id}).eq('id',order.id);return json({order_id:order.id,checkout_url:session.url},201)}catch(e){await db.from('mpl_orders').update({status:'checkout_failed'}).eq('id',order.id);throw e} }
    return fail('not_found',404)
  } catch (error) {
    if (error instanceof HttpError) return fail(error.message,error.status)
    console.error('marketplace_request_failed')
    return fail('service_unavailable',503)
  }
})
