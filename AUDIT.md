# Hosted runtime audit / 托管运行时审计

## Fixed in this patch / 本次修复

- Preserve JavaScript regex escapes in generated HTML; the served script is syntax-tested.
- Health probes PostgreSQL with a timeout and returns 503 for database failure.
- Session inserts are checked before returning login tokens; database errors do not become authentication errors.
- JSON bodies are stream-limited to 64 KiB, must be objects, and reject invalid encoding.
- Credentials and listing text/prices have explicit type and size limits.
- Internal database/provider errors are not returned to visitors.
- Hosted payment routes return 503 before database writes, even if keys are later configured.

修复生成页面的脚本转义、数据库健康检查、会话写入错误处理、请求体大小和类型校验、凭据与商品字段边界。内部错误不再原样返回。托管支付接口在写入数据库前拒绝请求，不会因为后来填入密钥就自动开启。

## Outstanding release gates / 尚未通过的发布门槛

The legacy hosted payment implementation must not be enabled as-is:

1. Event deduplication and order settlement must commit in one database transaction.
2. Settlement must validate paid status, currency, amount and order ownership; cover delayed and reordered events.
3. Partial refunds must not be marked fully refunded. Hosted admin refund functionality is not implemented.
4. Checkout needs idempotency, recovery from provider/database partial failure and concurrent requests.
5. Real Stripe test Checkout → signed webhook → refund acceptance must pass; mock tests are insufficient.
6. Auth needs durable rate limits, recovery, logout/revocation and a review of browser token storage/XSS risk.
7. Hosted search filters need safe structured input handling, and the UI needs comprehensive browser/accessibility tests.

旧版托管支付逻辑不得直接开启：必须补齐事务化幂等入账、金额/币种/支付状态校验、乱序事件、部分退款、管理员退款、并发结账恢复以及真实 Stripe 测试验收。鉴权仍需持久化限流、找回、注销撤销及令牌存储审查；搜索和页面测试仍需完善。本审计不代表整体生产验收完成。

## Verify / 验证

Run `node --test` on Node 24+. `tests/edge.test.js` executes the real Edge handler with a database transport double; it does not claim remote PostgreSQL or Stripe E2E coverage.

使用 Node 24+ 执行 `node --test`。Edge 测试执行真实处理函数，但数据库传输为替身；这不等同远程数据库或 Stripe 端到端测试。

## Rollback / 回滚

No schema is changed. Re-deploy the previous committed function only if necessary; it restores the known script and error-handling defects. Keep Stripe secrets absent and do not activate the old payment code. Prefer rolling forward with a fix. Do not remove payment safety gates without completing the release checklist.

本次无数据库迁移。必要时可重部署此前提交，但会恢复已知页面及错误处理缺陷，因此优先向前修复。回滚时必须保持 Stripe 密钥未配置，不能开启旧支付代码；发布清单完成前不得移除支付保护。
