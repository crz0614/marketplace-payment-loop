# MarketLoop · Marketplace Payment Loop

A marketplace backend implementing the following lifecycle, with verification limits documented below: account authentication, service listings, search, orders, Stripe Checkout, signed/idempotent webhooks, refunds and an admin boundary.

一个实现以下流程的 Marketplace 后端（验证边界见下文）：账户鉴权、服务发布、搜索、订单、Stripe Checkout、签名且幂等的 Webhook、退款和管理员权限边界。

## Business problem · 业务问题

Marketplace demos often stop at a visual checkout button. MarketLoop persists every state transition on the server and treats Stripe events—not browser redirects—as payment truth.

许多 Marketplace 演示只做到前端支付按钮。MarketLoop 在服务端持久化全部状态，并以 Stripe Webhook 而不是浏览器跳转作为付款事实来源。

## Deployment evidence · 部署与验证证据

[Hosted service / 在线入口](https://hqxyjaepuaruiwdfvvqj.supabase.co/functions/v1/marketplace-payment-loop) · [Deployment PR #3 / 部署证据](https://github.com/crz0614/marketplace-payment-loop/pull/3)

The merged deployment PR records successful registration (201), authenticated session lookup (200), listing creation (201), and search/readback (200), with disposable records removed afterwards. On 2026-09-03, migration `20260903130601_atomic_checkout_settlement` was applied to hosted PostgreSQL; a disposable transaction verified initial settlement, duplicate suppression and rollback without persisting test records, and Edge Function v4 was deployed. Migration `20260903140721_atomic_registration` was also applied: a disposable transaction verified one user plus one session on success and zero orphan users after a forced session conflict. Edge Function v5 was deployed. Migration `20260903150447_safe_listing_search` was then applied: hosted tests confirmed literal handling of PostgREST metacharacters, denied execution to `anon` and `authenticated`, and rolled back all disposable rows. Edge Function v6 was deployed. External HTTP probing was blocked by the verification environment, so current uptime and real payment acceptance are not claimed.

部署 PR 记录了注册、会话鉴权、服务发布和搜索回读成功，验证后已清理临时记录。2026-09-03 已将 `20260903130601_atomic_checkout_settlement` 应用于线上 PostgreSQL，并在可回滚事务中验证首次入账、重复抑制及失败回滚，未保留测试记录；Edge Function v4 同步完成部署。同时应用 `20260903140721_atomic_registration`：可回滚事务验证正常路径只创建一个用户和一个会话，强制会话冲突后遗留用户为零；Edge Function v5 已部署。外部 HTTP 探测受验证环境网络策略阻止，因此不声明当前在线可用或真实支付验收完成。

| Runtime / 运行形态 | Persistence and session / 持久化与会话 | Verification boundary / 验证边界 |
| --- | --- | --- |
| Hosted Supabase Edge | PostgreSQL; hashed bearer tokens, browser token in localStorage / PostgreSQL；服务端保存令牌哈希，浏览器 localStorage 保存 bearer token | Registration, auth, publishing and search recorded in PR #3 / PR #3 记录注册、鉴权、发布与搜索 |
| Local Node + Docker | SQLite WAL; hashed tokens in HttpOnly, SameSite cookies / SQLite WAL；HttpOnly、SameSite Cookie 会话 | Automated HTTP tests use a Stripe transport double / HTTP 自动测试使用 Stripe 传输替身 |

**Payment status: not end-to-end verified with Stripe.** Real test-mode Checkout, signed event settlement and refund verification remain outstanding. Configuration flags alone are not payment evidence. Never submit real card details or customer data to this evaluation deployment.

**支付状态：尚未完成真实 Stripe 端到端验证。** 仍需实际测试支付、签名事件入账和退款验证；配置状态不等于支付成功证据。请勿在评估部署中提交真实银行卡或客户数据。

## Local implementation scope · 本地实现范围

- PBKDF2 password hashing and hashed server-side session tokens in HttpOnly, SameSite cookies
- Same-origin enforcement for browser mutations; Stripe uses its independently signed webhook route
- Persistent SQLite WAL database with foreign keys and transactions
- Authenticated listing creation, current-session logout/revocation and public bounded search
- Server-priced orders; clients cannot submit totals
- Stripe Checkout Session creation through the official REST API
- Timestamped HMAC webhook verification and event deduplication
- Prometheus-compatible `/metrics` endpoint with aggregate users, listings, orders and durable webhook-event counts (no emails, IDs or payment data)
- Admin-only full or partial refund requests
- Working browser interface for registration, login, service publishing, search, Checkout creation, order history and admin refunds
- Automated HTTP end-to-end tests covering paid-order and refund flows
- Docker/Compose deployment with a read-only filesystem and persistent volume

The following list describes the local Node runtime; do not assume hosted feature or security parity.

以下清单描述本地 Node 运行形态，不能据此推断托管版本具有相同功能或安全机制。

## Run locally · 本地运行

    cp .env.example .env
    npm test
    npm start

## Commerce Ops schema · 电商运营数据结构

The applied Commerce Ops migrations are tracked as `20260903164749_commerce_ops_core.sql` and `20260903164817_commerce_ops_advisor_fixes.sql`. They reproduce the hosted PostgreSQL tables, seven-channel constraint, idempotent order key, atomic import function, indexes, RLS and service-role-only access. A fresh Supabase environment can therefore rebuild the order ledger from the repository instead of relying on dashboard-only SQL.

The authenticated Commerce Ops API and bilingual console also expose the latest 100 import runs for the current owner, including source filename, row count and timestamp. This makes repeated uploads and reconciliation work traceable without exposing another operator's records.

已上线的电商运营迁移现已作为 `20260903164749_commerce_ops_core.sql` 和 `20260903164817_commerce_ops_advisor_fixes.sql` 纳入版本控制，包含三张 PostgreSQL 表、七渠道约束、订单幂等键、原子导入函数、索引、RLS 及仅限服务角色的访问边界。新 Supabase 环境可直接从仓库重建订单账本，不再依赖控制台中的未记录 SQL。

鉴权后的电商运营 API 与双语控制台还会展示当前账户最近 100 次导入记录，以及最近 200 条订单；两者都标明所属店铺与渠道，订单还可通过鉴权 API 按店铺筛选，便于追踪重复上传与跨平台对账，同时不会暴露其他运营者的记录。

Rollback is non-destructive: deploy the previous Edge Function, which does not call Commerce Ops routes, and leave the tables intact. Drop the function and tables only after an export and a verified zero-row check; dropping a shop cascades to its imports and order lines.

回滚默认不删除数据：先恢复上一版 Edge Function，使其不再调用电商运营接口，同时保留表。只有完成导出并确认三张表均无业务记录后才能删除函数与表；删除店铺会级联删除对应导入记录和订单行。

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
