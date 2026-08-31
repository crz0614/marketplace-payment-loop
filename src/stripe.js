import { createHmac, timingSafeEqual } from 'node:crypto';

export class StripeClient {
  constructor(secretKey, webhookSecret, fetchImpl = fetch) {
    this.secretKey = secretKey; this.webhookSecret = webhookSecret; this.fetch = fetchImpl;
  }
  configured() { return Boolean(this.secretKey && this.webhookSecret); }
  async request(path, fields) {
    if (!this.secretKey) throw new Error('stripe_not_configured');
    const response = await this.fetch('https://api.stripe.com/v1/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.secretKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'stripe_request_failed');
    return result;
  }
  createCheckout(order, origin) {
    return this.request('checkout/sessions', {
      mode: 'payment',
      success_url: origin + '/?checkout=success&order=' + order.id,
      cancel_url: origin + '/?checkout=cancelled&order=' + order.id,
      'line_items[0][price_data][currency]': order.currency,
      'line_items[0][price_data][product_data][name]': order.title,
      'line_items[0][price_data][unit_amount]': String(order.total_cents / order.quantity),
      'line_items[0][quantity]': String(order.quantity),
      'metadata[order_id]': order.id
    });
  }
  refund(paymentIntent, amount) {
    const fields = { payment_intent: paymentIntent };
    if (amount) fields.amount = String(amount);
    return this.request('refunds', fields);
  }
  verify(payload, header, tolerance = 300) {
    if (!this.webhookSecret || !header) throw new Error('invalid_signature');
    const parts = Object.fromEntries(header.split(',').map(part => part.split('=')));
    const timestamp = Number(parts.t), signature = parts.v1;
    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > tolerance) throw new Error('invalid_signature');
    const expected = createHmac('sha256', this.webhookSecret).update(timestamp + '.' + payload).digest('hex');
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error('invalid_signature');
    return JSON.parse(payload);
  }
}
