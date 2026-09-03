import test from "node:test";
import assert from "node:assert/strict";
import { CHANNELS, idempotencyKey, normalizeOrder } from "../src/domain.mjs";

test("covers every requested marketplace", () => {
  assert.deepEqual(Object.keys(CHANNELS).slice(0, 5), ["amazon", "taobao", "pinduoduo", "douyin", "xiaohongshu"]);
});
test("normalizes an exported order without floating point money", () => {
  const order = normalizeOrder("taobao", { external_order_id:"TB-1", sku:"SKU-1", quantity:"2", amount:"19.90", currency:"cny", status:"paid", occurred_at:"2026-09-03T00:00:00Z" });
  assert.equal(order.amount_minor, 1990);
  assert.equal(order.currency, "CNY");
  assert.equal(idempotencyKey("shop-1", order), "shop-1\u001fTB-1\u001fSKU-1");
});
test("rejects unsupported channels and malformed money", () => {
  const base = { external_order_id:"1", sku:"1", quantity:1, amount:"1.999", currency:"CNY", status:"paid", occurred_at:"2026-09-03" };
  assert.throws(() => normalizeOrder("unknown", base), /unsupported/);
  assert.throws(() => normalizeOrder("amazon", base), /invalid_amount/);
});
