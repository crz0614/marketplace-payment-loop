# Hosted runtime audit / 托管运行时审计

## Fixed in this patch / 本次修复

- Preserve JavaScript regex escapes in generated HTML; the served script is syntax-tested.
- Health probes PostgreSQL with a timeout and returns 503 for database failure.
- Session inserts are checked before returning login tokens; database errors do not become authentication errors.
- JSON bodies are stream-limited to 64 KiB, must be objects, and reject invalid encoding.
- Credentials and listing text/prices have explicit type and size limits.
- Internal database/provider errors are not returned to visitors.
- Hosted payment routes return 503 before database writes, even if keys are later configured.
- Checkout event deduplication and order settlement now share one restricted database transaction; payment remains disabled until the remaining gates pass.
- Registration and first-session creation now share one restricted database transaction, so a session failure cannot strand an unusable email address.
- Listing search now passes user text as an RPC parameter instead of interpolating it into PostgREST filter syntax.

修复生成页面的脚本转义、数据库健康检查、会话写入错误处理、请求体大小和类型校验、凭据与商品字段边界。内部错误不再原样返回。托管支付接口在写入数据库前拒绝请求，不会因为后来填入密钥就自动开启。

## Outstanding release gates / 尚未通过的发布门槛

The legacy hosted payment implementation must not be enabled as-is:

1. **Completed 2026-09-03:** applied migration `20260903130601_atomic_checkout_settlement` to hosted PostgreSQL and verified success, duplicate suppression and mismatch rollback inside a disposable transaction.
2. Settlement validates paid status, currency, amount and checkout/order identity; delayed and reordered event coverage remains outstanding.
3. Partial refunds must not be marked fully refunded. Hosted admin refund functionality is not implemented.
4. Checkout needs idempotency, recovery from provider/database partial failure and concurrent requests.
5. Real Stripe test Checkout → signed webhook → refund acceptance must pass; mock tests are insufficient.
6. Registration is now atomic; auth still needs durable rate limits, recovery, logout/revocation and a review of browser token storage/XSS risk.
7. Hosted search now uses a restricted parameterized database function; the UI still needs comprehensive browser/accessibility tests.

旧版托管支付逻辑不得直接开启：必须补齐事务化幂等入账、金额/币种/支付状态校验、乱序事件、部分退款、管理员退款、并发结账恢复以及真实 Stripe 测试验收。鉴权仍需持久化限流、找回、注销撤销及令牌存储审查；搜索和页面测试仍需完善。本审计不代表整体生产验收完成。

## Verify / 验证

Run `node --test` on Node 24+. `tests/edge.test.js` executes the real Edge handler with a database transport double. On 2026-09-03, the hosted PostgreSQL function was exercised in a disposable transaction: the first settlement returned true, an identical event returned false, and the surrounding transaction rolled back all test records. Edge Function v4 was deployed from the merged source. Migration `20260903140721_atomic_registration` was then applied; one disposable transaction created exactly one user and one session, while a forced duplicate-session failure left zero orphan users. Edge Function v5 was deployed. External HTTP health verification was blocked by the verification environment, so current uptime is not claimed. Real Stripe E2E coverage remains outstanding.

使用 Node 24+ 执行 `node --test`。Edge 测试执行真实处理函数，但数据库传输为替身。2026-09-03 已在线上 PostgreSQL 的可回滚事务中验证首次入账返回 true、重复事件返回 false，并回滚全部测试记录；Edge Function v4 已从合并代码部署。随后应用 `20260903140721_atomic_registration`：可回滚事务验证正常路径只创建一个用户和一个会话，强制会话冲突后遗留用户为零；Edge Function v5 已部署。搜索回归测试还验证带 PostgREST 特殊字符的输入只作为 RPC 参数传入。外部 HTTP 探测受验证环境网络策略阻止，因此不声明当前在线可用；真实 Stripe 端到端仍待完成。

## Rollback / 回滚

The hosted migration is additive and payment routes remain hard-disabled. If the function deployment regresses, redeploy the previous committed function while keeping Stripe secrets absent. Do not drop the settlement function or migration history during an incident; prefer a forward corrective migration. Do not remove payment safety gates without completing the release checklist.

线上迁移为增量变更，支付路由仍强制关闭。若函数部署回归，可在保持 Stripe 密钥未配置的前提下重部署上一已知版本；事故处理中不要删除入账函数或迁移历史，应以前向修复迁移处理。发布清单完成前不得移除支付保护。
