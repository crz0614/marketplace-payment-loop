# MarketLoop · Marketplace Payment Loop

A reproducible marketplace backend proving the complete commercial lifecycle: account authentication, service listings, search, orders, Stripe Checkout, signed/idempotent webhooks, refunds and an admin boundary.

一个可复现的 Marketplace 支付闭环：账户鉴权、服务发布、搜索、订单、Stripe Checkout、签名且幂等的 Webhook、退款和管理员权限边界。

## Business problem · 业务问题

Marketplace demos often stop at a visual checkout button. MarketLoop persists every state transition on the server and treats Stripe events—not browser redirects—as payment truth.

许多 Marketplace 演示只做到前端支付按钮。MarketLoop 在服务端持久化全部状态，并以 Stripe Webhook 而不是浏览器跳转作为付款事实来源。

## Verified scope · 可验证范围

- PBKDF2 password hashing and hashed server-side session tokens in HttpOnly, SameSite cookies
- Same-origin enforcement for browser mutations; Stripe uses its independently signed webhook route
- Persistent SQLite WAL database with foreign keys and transactions
- Authenticated listing creation plus public bounded search
- Server-priced orders; clients cannot submit totals
- Stripe Checkout Session creation through the official REST API
- Timestamped HMAC webhook verification and event deduplication
- Prometheus-compatible `/metrics` endpoint with aggregate users, listings, orders and durable webhook-event counts (no emails, IDs or payment data)
- Admin-only full or partial refund requests
- Automated HTTP end-to-end tests covering paid-order and refund flows
- Docker/Compose deployment with a read-only filesystem and persistent volume

## Run · 运行

    cp .env.example .env
    npm test
    npm start

Forward Stripe test events with:

    stripe listen --forward-to localhost:3000/api/webhooks/stripe

Create seller and buyer accounts, publish a listing, then create an order. The order becomes paid only after a verified checkout event. Refund requests require the configured admin account; the signed refund webhook is durable accounting truth.

Monitoring: scrape `GET /metrics` with Prometheus or any OpenMetrics-compatible collector. The endpoint intentionally exposes only aggregate counts and sends `Cache-Control: no-store`.

创建卖家和买家账户，卖家发布服务，买家创建订单。只有收到并验证 Checkout 事件后，订单才会变为已付款。退款接口仅允许管理员调用，最终状态以签名 Webhook 为准。

## Failure and rollback · 失败与回滚

- Stripe unavailable: the order remains as checkout_failed; no payment is claimed.
- Duplicate webhook IDs are ignored transactionally.
- Invalid or expired signatures are rejected before database mutation.
- Roll back by starting the previous container image against the same persistent volume.
- A refund API response is not final accounting truth; the signed webhook closes the loop.
- `/metrics` 仅暴露用户、上架服务、订单状态和已持久化 Webhook 事件的汇总数量，不包含邮箱、订单号或支付数据，可由 Prometheus 采集。

## Production boundary · 生产边界

The automated suite uses a deterministic Stripe transport double. A public portfolio claim requires a test-mode deployment with real Stripe test credentials, a successful Checkout, signed webhook and refund. No customer, order or revenue is invented.

自动化测试使用确定性的 Stripe 传输替身。加入公开作品集前，仍需配置真实 Stripe 测试密钥，完成 Checkout、签名 Webhook 和退款验证。项目不会虚构客户、订单或收入。
