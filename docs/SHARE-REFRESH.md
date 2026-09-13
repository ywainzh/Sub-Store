# 订阅启停与 Clash-Full 刷新

`Clash-Full` 使用 `mihomoConfig`、`sourceType: local`，通过
`Add Proxies From Subscription Operator` 从组合「大海的海」替换顶层 `proxies`。
分组直接引用这次生成的节点，客户端刷新完整分享后即可同步启停结果。

## 当前配置约定

- 注入处理器保持 `sourceType: collection`、`sourceName: 大海的海`、`position: replace`。
- 动态组使用 `include-all-proxies: true`；地区组同时设置与实际节点名称匹配的 `filter`。
- 手动组保留对应自动组为首项；自动组保留测速配置。
- 自动组设置 `empty-fallback: REJECT`，地区没有可用节点时拒绝连接，避免默认回退到直连。
- 不再配置从同一组合分享拉取节点的 HTTP `proxy-providers.ocean`，也不使用 `use: [ocean]`。
- 分享文件名、组合成员关系和原分享 token 保持不变。只通过管理 API 更新文件内容。

例如日本分组：

```yaml
proxy-groups:
  - name: 自动-JP日本
    type: url-test
    include-all-proxies: true
    filter: '(JP|日本)'
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    empty-fallback: REJECT
  - name: JP日本
    type: select
    proxies: [自动-JP日本]
    include-all-proxies: true
    filter: '(JP|日本)'
```

已在 Mihomo v1.19.29 验证动态加入、移除及空地区回退。更换客户端或内核时，
应验证这些字段的实际行为。`include-all-proxies` 是有效字段，与无效的 `include` 不同。

## 2026-09-13 故障原因与验收

关闭「宝可梦」后，后端状态为 `active: false`，完整分享与组合分享均已排除它。
Clash Verge 刷新了主配置，但分组仍使用独立的 HTTP `ocean` provider：
其刷新间隔为 86400 秒，缓存停在前一天，仍有 33 个名称与停用来源匹配的节点。
因此，只检查分享响应的顶层节点或 HTTP 200 无法证明客户端分组已经更新。

改为直接使用顶层节点后，按以下链路验收：

1. `/api/subs/status` 确认手动停用状态；不要为了排障重新启用生产来源。
2. 通过管理员单条预览识别停用来源，再比较原分享响应中的节点名称或脱敏指纹。
3. 用目标 Mihomo 内核执行配置校验，并在隔离实例验证旧配置可复现残留、新配置可移除及恢复节点。
4. 在 Clash Verge 刷新原订阅，核对保存的订阅内容与分享响应一致。
5. 检查内核 `/providers/proxies` 与 `/proxies`：旧 `ocean` 不再加载，各组没有停用节点，启用节点完整保留。

本次验收保留 46 个启用节点，停用来源在分享和客户端分组中均为零；
「全部节点」包含 46 个节点加 1 个自动组，「自动-全部节点」包含 46 个节点。
订阅开关、组合、分享 token 和分流规则均保持原值。本次只修正线上文件配置，后端仍为 v0.1.3。

诊断输出只记录状态、名称、数量或哈希，不输出订阅凭据、分享 token、节点密码或完整私有配置。
