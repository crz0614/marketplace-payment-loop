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

The applied Commerce Ops migrations are tracked as `20260903164749_commerce_ops_core.sql`, `20260903164817_commerce_ops_advisor_fixes.sql`, `20260904052000_commerce_canonical_status.sql`, `20260904062000_commerce_order_summary.sql`, `20260904075000_commerce_inventory.sql`, `20260904081500_commerce_inventory_summary.sql`, `20260904101000_commerce_inventory_exceptions.sql`, `20260904113000_commerce_inventory_exception_actions.sql` and `20260904114500_commerce_inventory_exception_action_index.sql`. They reproduce the hosted PostgreSQL order and latest-inventory tables, seven-channel constraint, idempotent order key, atomic import/upsert, summaries and reconciliation workflow, indexes, RLS and service-role-only access. A fresh Supabase environment can therefore rebuild the operational ledger from the repository instead of relying on dashboard-only SQL.

The authenticated Commerce Ops API and bilingual console also expose the latest 100 import runs and 200 order lines for the current owner. Both retain shop and channel context. Every order keeps its unmodified source status and derives a stored canonical status: pending payment, processing, shipped, completed, cancelled, refunded or other. The ledger can combine shop, canonical status, original status and an inclusive UTC date range without exposing another operator's records. The same owner-scoped filters export both statuses in UTF-8 CSV; values are quoted and formula-leading fields are neutralized, while the 200-row bound remains explicit. A restricted server-side summary covers all owner rows—not only the visible 200—grouped by canonical status and currency, with distinct-order, unit and imported-amount totals. Imported amount is explicitly not presented as revenue. Official inventory exports can be mapped to SKU, available quantity and reorder point; each shop/SKU is atomically updated, the source filename and capture time remain auditable, and low-stock results are owner-scoped and bounded to 200 rows. The selected shop's latest 200 low-stock rows can be exported as a UTF-8 purchasing handoff with formula-leading fields neutralized; the file exposes thresholds but deliberately does not invent replenishment quantities. A second restricted summary groups up to 200 exact-match SKUs across shops, totaling available stock and reorder points while counting affected low-stock shops. A reconciliation exception list identifies up to 200 order SKUs without an exact inventory record in the same shop, exposing missing imports and mapping errors without fuzzy or cross-owner matching. Each current exception can be marked investigating or ignored with a 500-character note; resetting it to open clears that stored action, while importing an exact inventory match removes the exception automatically. The current action-status view can be exported as a UTF-8 CSV handoff including notes and timestamps, with spreadsheet-formula injection neutralized.

The reconciliation queue can be filtered server-side to all, open, investigating or ignored exceptions. The filter remains owner-scoped and rejects unknown action states before querying PostgreSQL.

已上线的电商运营迁移现已作为 `20260903164749_commerce_ops_core.sql`、`20260903164817_commerce_ops_advisor_fixes.sql`、`20260904052000_commerce_canonical_status.sql`、`20260904062000_commerce_order_summary.sql`、`20260904075000_commerce_inventory.sql`、`20260904081500_commerce_inventory_summary.sql`、`20260904101000_commerce_inventory_exceptions.sql`、`20260904113000_commerce_inventory_exception_actions.sql` 和 `20260904114500_commerce_inventory_exception_action_index.sql` 纳入版本控制，包含 PostgreSQL 订单与最新库存表、七渠道约束、订单幂等键、原子导入/更新、汇总与对账流程、索引、RLS 及仅限服务角色的访问边界。新 Supabase 环境可直接从仓库重建运营台账，不再依赖控制台中的未记录 SQL。

鉴权后的电商运营 API 与双语控制台会展示当前账户最近 100 次导入记录和最近 200 条订单。每笔订单保留平台原始状态，同时生成待付款、待处理、已发货、已完成、已取消、退款或其他标准状态；店铺、标准状态、原始状态和 UTC 日期可组合筛选。相同的账户隔离筛选可导出同时包含两种状态的 UTF-8 CSV，字段会安全引用并中和公式前缀。受限的服务端汇总不受 200 条明细上限影响，按标准状态和币种给出当前账户的去重订单数、商品数量和导入金额，并明确不把导入金额表述为收入。官方库存导出文件可映射到 SKU、可售数量和补货阈值；同一店铺/SKU 会原子更新，来源文件与采集时间可追溯，低库存结果按账户隔离并限制为 200 条。当前店铺最近 200 条低库存记录可导出为 UTF-8 采购交接文件，公式前缀会被中和；文件提供阈值但不擅自推断补货数量。第二个受限汇总会按完全一致的 SKU 聚合最多 200 个商品，计算跨店铺可售库存、补货阈值及低库存店铺数。对账异常清单会列出同一店铺中已出现在订单、却没有完全匹配库存记录的最多 200 个 SKU，暴露漏导或映射错误，不使用模糊匹配，也不会跨账户匹配。当前异常可保存为调查中或已忽略并附 500 字备注；重置为待处理会清除保存的状态，导入同店铺完全匹配库存后异常则自动消失。

对账队列现可在服务端筛选全部、待处理、调查中或已忽略状态；筛选继续按账户隔离，并在查询 PostgreSQL 前拒绝未知状态。

Rollback is non-destructive: deploy the previous Edge Function and leave the tables intact. Before reverting exception actions, export any notes that must be retained, drop `vco_set_inventory_exception_action(uuid,uuid,text,text,text)`, restore the prior `vco_inventory_exceptions(uuid)`, then drop `vco_inventory_exception_actions`. Drop `vco_inventory_summary(uuid)` before `vco_upsert_inventory(uuid,uuid,text,jsonb)`, then export and verify zero inventory rows before dropping `vco_inventory`; separately drop `vco_order_summary(uuid)` if reverting order summaries. To remove canonical statuses, first deploy the previous function, then drop the canonical-status index, constraint and generated column; the source `status` values remain intact. Drop the order import function and tables only after an export and a verified zero-row check; dropping a shop cascades to its imports, order lines and inventory.

回滚默认不删除数据：先恢复上一版 Edge Function；回退异常处理状态前先导出需保留的备注，删除 `vco_set_inventory_exception_action(uuid,uuid,text,text,text)`，恢复上一版 `vco_inventory_exceptions(uuid)` 后再删除 `vco_inventory_exception_actions`。库存功能需依次删除 `vco_inventory_summary(uuid)` 与 `vco_upsert_inventory(uuid,uuid,text,jsonb)`，导出并确认库存为零后才能删除 `vco_inventory`；订单汇总可单独删除 `vco_order_summary(uuid)`。移除标准状态时再依次删除索引、约束和生成列，平台原始 `status` 不受影响。只有完成导出并确认无业务记录后才能删除订单导入函数与表；删除店铺会级联删除对应导入记录、订单行和库存。

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
