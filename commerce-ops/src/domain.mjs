export const CHANNELS = Object.freeze({
  amazon: { label: "Amazon", api: "Selling Partner API" },
  taobao: { label: "淘宝 / 天猫", api: "淘宝开放平台" },
  pinduoduo: { label: "拼多多", api: "拼多多开放平台" },
  douyin: { label: "抖音电商", api: "抖店开放平台" },
  xiaohongshu: { label: "小红书", api: "小红书开放平台" },
  shopify: { label: "Shopify", api: "Shopify Admin API" },
  woocommerce: { label: "WooCommerce", api: "WooCommerce REST API" }
});

export function normalizeOrder(channel, row) {
  if (!CHANNELS[channel]) throw new Error("unsupported_channel");
  const externalOrderId = text(row.external_order_id, "external_order_id");
  const sku = text(row.sku, "sku");
  const quantity = integer(row.quantity, "quantity", 1);
  const amountMinor = money(row.amount, row.currency);
  const currency = text(row.currency, "currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("invalid_currency");
  return { channel, external_order_id: externalOrderId, sku, quantity, amount_minor: amountMinor, currency, status: text(row.status, "status"), occurred_at: iso(row.occurred_at) };
}

export function idempotencyKey(shopId, order) {
  return `${shopId}\u001f${order.external_order_id}\u001f${order.sku}`;
}

function text(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 255) throw new Error(`invalid_${field}`);
  return value.trim();
}
function integer(value, field, min) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) throw new Error(`invalid_${field}`);
  return parsed;
}
function money(value, currency) {
  text(currency, "currency");
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(raw.trim())) throw new Error("invalid_amount");
  const [whole, fraction = ""] = raw.trim().split(".");
  const minor = Number(whole) * 100 + Math.sign(Number(whole) || 1) * Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("invalid_amount");
  return minor;
}
function iso(value) {
  if (typeof value !== "string") throw new Error("invalid_occurred_at");
  const d = new Date(value);
  if (Number.isNaN(d.valueOf())) throw new Error("invalid_occurred_at");
  return d.toISOString();
}
