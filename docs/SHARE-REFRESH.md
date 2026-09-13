# 订阅启停与 Clash-Full 刷新

`Clash-Full` 使用 `mihomoConfig`、`sourceType: local`，通过
`Add Proxies From Subscription Operator` 从组合「大海的海」替换顶层 `proxies`。
随后通过内联 `Script Operator` 运行 [动态地区脚本](../scripts/dynamic-region-groups.js)，
从这次输出的节点重建地区分组、测速组及国旗。客户端刷新完整分享后同步节点和地区变化。

## 当前配置约定

- 注入处理器保持 `sourceType: collection`、`sourceName: 大海的海`、`position: replace`。
- 注入之后追加 `Script Operator`，`args.mode: script`、`args.content` 为脚本全文，入口为 `main(config)`。
  使用内联脚本，不在生成分享时下载脚本或查询外部地理位置服务。
- 存储模板先经过脚本的 `prepareRegionTemplate(config)`，移除固定地区组和候选引用。
  不要将生成结果中的节点或国家列表重新写死进模板。
- 地区按名称中的国家代码、国家名称和已有国旗识别，复用 `ProxyUtils.getISO`。
  无法识别的名称（例如 Fast/Balancer）及套餐提示归入「未识别地区」，不推断成美国等国家。
  识别前忽略名称中的网址和域名，避免将公告的 `.com` 误认为科摩罗的 `COM` 国家代码。
- 地区自动组和手动组直接列出本次节点的准确名称，不用宽泛正则；手动组首项为对应自动组。
  只有「全部节点」及其自动组继续使用 `include-all-proxies: true`。
- 有节点的地区生成两个组，没有节点则移除。保留 US、JP、HK、TW 的名称及优先顺序，
  其它地区按标准国家代码排序追加，未知地区放最后。节点原名和节点属性不变。
- 自动组从「自动-全部节点」继承测速 URL、interval、timeout、tolerance、lazy、hidden、
  max-failed-times 与 `empty-fallback: REJECT`。临时测速失败不改变地区列表。
- 默认节点、国外 AI、YouTube、Pixiv、游戏专用、下载软件、其他外网自动补齐地区选项。
  「日本网站」有 JP 节点时引用日本组，没有时使用 `REJECT`。
- 国家/地区图标使用 `https://flagcdn.com/w80/<小写国家代码>.png`，仅客户端加载图片；
  未识别地区复用「全部节点」的地球图标。图片加载不参与配置生成或分流。
- 不再配置从同一组合分享拉取节点的 HTTP `proxy-providers.ocean`，也不使用 `use: [ocean]`。
- 分享文件名、组合成员关系和原分享 token 保持不变。只通过管理 API 更新文件内容。

例如本次有新加坡节点时生成：

```yaml
proxy-groups:
  - name: 自动-SG新加坡
    type: url-test
    proxies: [SG-example]
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    tolerance: 50
    lazy: true
    empty-fallback: REJECT
    icon: https://flagcdn.com/w80/sg.png
  - name: SG新加坡
    type: select
    proxies: [自动-SG新加坡, SG-example]
    icon: https://flagcdn.com/w80/sg.png
```

修改脚本后应执行后端测试，并用实际 Mihomo 内核验证生成配置和来源启停。
应用前在仓库外的私有目录备份旧文件；只通过 `PATCH /api/file/Clash-Full` 更新 `content` 和 `process`，
保留其余字段和原分享 token。完整分享、节点、分流规则和客户端验收失败时恢复旧文件。
此配置处理不需要升级服务程序，也不新增后台定时任务；变化在客户端下次更新完整订阅时生效。

## 2026-09-13 历史缓存故障与验收

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
