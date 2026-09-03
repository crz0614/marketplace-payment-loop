# Vesper Commerce Ops / 多渠道电商运营中台

A small, auditable order-ingestion core for Amazon, Taobao/Tmall, Pinduoduo, Douyin Shop, Xiaohongshu, Shopify and WooCommerce.

面向 Amazon、淘宝/天猫、拼多多、抖音电商、小红书、Shopify 与 WooCommerce 的轻量、可审计订单接入核心。

## Honest support matrix / 真实支持状态

All seven channels share a tested canonical model and support official-export ingestion. Direct APIs remain `awaiting_authorization` until a real merchant grants access. No scraping or unofficial reverse-engineered API is used.

七个渠道均使用经过测试的统一模型，并覆盖官方后台导出文件导入。直接 API 在真实商家授权前统一标为 `awaiting_authorization`；不使用爬虫或非官方逆向接口。

## Verified core / 已验证核心

- Exact minor-unit money conversion; no floating-point accounting / 金额转换为最小货币单位
- Atomic PostgreSQL batch import and idempotent upsert / PostgreSQL 原子批量导入与幂等更新
- Owner isolation, RLS, least-privilege grants / 所有者隔离、RLS 与最小权限
- Empty public state; no fictional shops, orders or revenue / 公开环境为空，不使用虚构业务数据

Run `npm test && npm run check`.

## Official API boundary / 官方 API 边界

- Amazon: Selling Partner API
- 淘宝/天猫: 淘宝开放平台
- 拼多多: 拼多多开放平台
- 抖音: 抖店开放平台
- 小红书: 小红书开放平台
- Shopify: Admin API
- WooCommerce: REST API

Each connector needs its own official app credentials, permissions and merchant consent. Secrets will be server-side only. / 每个连接器都必须取得官方应用凭据、权限及商家授权，密钥仅保存在服务端。

## Rollback / 回滚

Disable ingestion first, then drop `public.vco_order_lines`, `public.vco_imports`, `public.vco_shops` and `public.vco_import_order_lines` in reverse dependency order. Export real records before rollback.

先关闭导入入口，再按依赖逆序移除函数及三张 `vco_*` 表；回滚前必须导出真实记录。

Built by Vesper Chen.
