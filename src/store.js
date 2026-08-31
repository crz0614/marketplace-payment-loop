import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, pbkdf2Sync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const now = () => new Date().toISOString();
const sessionHash = token => createHash('sha256').update(String(token)).digest('hex');
const passwordHash = (password, salt = randomBytes(16).toString('hex')) =>
  salt + ':' + pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex');
const passwordOK = (password, encoded) => {
  const [salt, expected] = encoded.split(':');
  return timingSafeEqual(pbkdf2Sync(password, salt, 210000, 32, 'sha256'), Buffer.from(expected, 'hex'));
};

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS listings(id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,description TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>0),currency TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,buyer_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,total_cents INTEGER NOT NULL,currency TEXT NOT NULL,stripe_session_id TEXT UNIQUE,stripe_payment_intent TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS order_items(order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,listing_id TEXT NOT NULL REFERENCES listings(id),title TEXT NOT NULL,unit_cents INTEGER NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),PRIMARY KEY(order_id,listing_id));' +
      'CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,type TEXT NOT NULL,received_at TEXT NOT NULL);' +
      'CREATE INDEX IF NOT EXISTS listings_search ON listings(status,title);CREATE INDEX IF NOT EXISTS orders_buyer ON orders(buyer_id,created_at);'
    );
  }
  close() { this.db.close(); }
  createUser(email, password, role = 'buyer') {
    email = String(email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email) || String(password).length < 10) throw new Error('invalid_credentials');
    const user = { id: randomUUID(), email, role, created_at: now() };
    this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id, email, passwordHash(password), role, user.created_at);
    return user;
  }
  ensureAdmin(email, password) {
    if (email && password && !this.db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase())) this.createUser(email, password, 'admin');
  }
  authenticate(email, password) {
    const row = this.db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase());
    return row && passwordOK(password, row.password_hash) ? { id: row.id, email: row.email, role: row.role } : null;
  }
  createSession(userId) {
    const token = randomBytes(32).toString('base64url'), expires = new Date(Date.now() + 604800000).toISOString();
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(sessionHash(token), userId, expires, now());
    return { token, expires };
  }
  session(token) {
    if (!token) return null;
    return this.db.prepare('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(sessionHash(token), now()) || null;
  }
  deleteSession(token) { this.db.prepare('DELETE FROM sessions WHERE token=?').run(sessionHash(token)); }
  createListing(userId, input) {
    const title = String(input.title || '').trim(), description = String(input.description || '').trim(), price = Number(input.price_cents);
    if (title.length < 3 || description.length < 10 || !Number.isInteger(price) || price < 50) throw new Error('invalid_listing');
    const item = { id: randomUUID(), seller_id: userId, title, description, price_cents: price, currency: 'usd', status: 'active', created_at: now() };
    this.db.prepare('INSERT INTO listings VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(item));
    return item;
  }
  listings(query = '') {
    const q = '%' + query.trim().slice(0, 80) + '%';
    return this.db.prepare("SELECT id,title,description,price_cents,currency,created_at FROM listings WHERE status='active' AND (title LIKE ? OR description LIKE ?) ORDER BY created_at DESC LIMIT 50").all(q, q);
  }
  createOrder(buyerId, listingId, quantity = 1) {
    const listing = this.db.prepare("SELECT * FROM listings WHERE id=? AND status='active'").get(listingId);
    if (!listing || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error('invalid_order');
    if (listing.seller_id === buyerId) throw new Error('self_purchase');
    const id = randomUUID(), stamp = now(), total = listing.price_cents * quantity;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?)').run(id,buyerId,'checkout_pending',total,listing.currency,null,null,stamp,stamp);
      this.db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?)').run(id,listing.id,listing.title,listing.price_cents,quantity);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { id, total_cents: total, currency: listing.currency, title: listing.title, quantity };
  }
  attachCheckout(id, sessionId) { this.db.prepare('UPDATE orders SET stripe_session_id=?,status=?,updated_at=? WHERE id=?').run(sessionId,'awaiting_payment',now(),id); }
  failCheckout(id) { this.db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run('checkout_failed',now(),id); }
  applyStripeEvent(event) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const inserted = this.db.prepare('INSERT OR IGNORE INTO webhook_events VALUES(?,?,?)').run(event.id,event.type,now());
      if (!inserted.changes) { this.db.exec('ROLLBACK'); return false; }
      const obj = event.data?.object || {};
      if (event.type === 'checkout.session.completed') this.db.prepare('UPDATE orders SET status=?,stripe_payment_intent=?,updated_at=? WHERE stripe_session_id=?').run('paid',obj.payment_intent||null,now(),obj.id);
      if (event.type === 'charge.refunded') this.db.prepare('UPDATE orders SET status=?,updated_at=? WHERE stripe_payment_intent=?').run('refunded',now(),obj.payment_intent);
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  order(id, user) {
    return user.role === 'admin' ? this.db.prepare('SELECT * FROM orders WHERE id=?').get(id) : this.db.prepare('SELECT * FROM orders WHERE id=? AND buyer_id=?').get(id,user.id);
  }
  orders(user) {
    return user.role === 'admin' ? this.db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all() : this.db.prepare('SELECT * FROM orders WHERE buyer_id=? ORDER BY created_at DESC LIMIT 100').all(user.id);
  }
}
