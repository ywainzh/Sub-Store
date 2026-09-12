# Clash 分流规则配置（file + 动态节点分组）技术手册

> 适用：Clash Verge（内核 Mihomo / Clash Meta）
> 说明：如何把一份「带分流量规规则的完整 Clash 配置」做成 Sub-Store 里的 **file**，
> 并让节点实时来自 `collection`（组合订阅），实现**增删节点自动进分组**。

---

## 0. 背景与目标

- **要一份带分流量规则的 Clash 配置**（`mode: rule`，含 proxy-groups、rules、rule-providers）。
- **节点不要写死**：配置里的节点由 Sub-Store 的 `collection`（如「大海的海」）**动态注入**，
  在 Sub-Store 增删节点 → 分享链接刷新即自动带新节点、并自动进对应分组。
- 关键机制 = **「mihomo 配置文件(file) + proxy-providers(ocean) + URLTest/Select 分组」**。

---

## 1. 实现的三大要素

### 1.1 配置文件类型 `mihomoConfig`
Sub-Store 里存一种文件，`content` 是**原始想分流的配置模板**（完整注册对象）。
- `type: "mihomoConfig"`（= mihomo/Clash Meta 配置）
- **`sourceType: "local"`**（⚠️ 必须 `local`，这样 `content` 才会被保存/保留；
  这款后端原生 mihomo 中 `sourceType:"none"` 会 `safeDump({})` 覆盖丢 content）
- 通过 **`Add Proxies From Subscription Operator`** 注入节点到顶层 `proxies`。

### 1.2 `Add Proxies From Subscription Operator`（动态节点）
把 collection（组合订阅）的节点**动态写入** `proxies`：
```json
{
  "type": "Add Proxies From Subscription Operator",
  "args": {
    "sourceType": "collection",
    "sourceName": "大海的海",
    "includeUnsupportedProxy": true,
    "position": "replace"
  }
}
```
- `sourceType:"collection"` + `sourceName:"大海的海"` → 每次生成时把当时 collection 的所有节点写入 `proxies` 顶层。
- `position:"replace"` 控制是覆盖还是插入。

### 1.3 `proxy-providers` + `use` + `filter`（动态分组 / 自动区域）
仅“写入 `proxies` 顶层”还不够：proxy-groups 要引用**具体节点名**，而节点是动态的，
所以不能手写节点名。用 **mihomo 的 `proxy-providers`** 让分组引用一个**HTTP 订阅源**，
再配合 `use:` 一 `filter:`（正则）把节点自动归进对应区域组：

```yaml
proxy-providers:
  ocean:
    type: http
    url: "https://sub-store.0222999.xyz/share/col/大海的海?token=aI3z76_rHkrLUkTyu7TgQ&target=mihomo"
    interval: 86400
    health-check:
      enable: true          # ⚠️ mihomo 要求 health-check 必须有 enable 字段
      url: https://www.gstatic.com/generate_204
      interval: 300

proxy-groups:
  - name: US美国
    type: select            # select：首项“自动” + use 动态列全部节点，可手动锁任一
    proxies:
      - 自动-US            # 第 1 个 = 自动（url-test 自动测速）
    use:
      - ocean
    filter: "^US|^Fast|^Balancer|^Netflix|^Dedicated|^X1"
  - name: 自动-US
    type: url-test          # 自动：检测时自动切到延迟最低的节点
    url: https://cp.cloudflare.com/generate_204
    interval: 300
    tolerance: 50
    use:
      - ocean
    filter: "^US|^Fast|^Balancer|^Netflix|^Dedicated|^X1"
```

> 要点：`select` 组 + `use` 能动态列出全部该 provider 节点供手动选；
> 同时 `proxies`列表里放进一个 `自动-XX`(url-test) 作为首项 = “自动选最低延迟”。
> 用户行为：选「自动」→ 自动检测最低的节点；选手其它具体节点 → 固定用该节点。

---

## 2. 配置位于 Sub-Store 的完整结构

一段完整的 `file`（`mihomoConfig`, `sourceType:local`）`content` 示例结构：

```yaml
# 全局
mixed-port: 7890
allow-lan: true
mode: rule
external-controller: 127.0.0.1:9090
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - https://223.5.5.5/dns-query
    - https://dns.alidns.com/dns-query

# 分组
proxy-groups:
  - name: 默认节点
    type: select
    proxies: [全部节点, US美国, JP日本, HK香港, TW台湾, 新加坡, 国外AI, YouTube, ... , DIRECT]
  - name: 全部节点
    type: select
    proxies: [自动-全部节点]
    use: [ocean]
  - name: 自动-全部节点
    type: url-test
    use: [ocean]
  - name: US美国
    type: select
    proxies: [自动-US美国]
    use: [ocean]
    filter: "^US|..."
  - name: 自动-US美国
    type: url-test
    use: [ocean]
    filter: "^US|..."
  # ... JP / HK / TW / 新加坡 类推 ...
  # 功能组：国外AI / YouTube / Pixiv / 游戏专用 / 其他外网 / 下载软件 / 国内网站 / 跟踪分析 / 广告过滤...

# 节点 provider
proxy-providers:
  ocean: { ... }     # 见 1.3

# 规则
rule-providers:
  applications: { type: http, format: text, behavior: classical, url: "..." }
  ai: ...
  adblockmihomo: ...
  category-bank-jp: ...

rules:
  - ...(你想要的规则)...
```

之后把这段 `content` 通过 `PUT /api/files` 保存（type=`mihomoConfig`、sourceType=`local`），
再挂 `process`（Add Proxies）即为完整可运行的分享配置。

---

## 3. 创建 / 更新 / 分享的 API 步骤

### 3.1 保存（创建 or 整体替换） — `PUT /api/files`

```bash
# 服务器上，content 为上述 yaml 串
curl -X PUT http://127.0.0.1:3000/api/files \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"mihomoConfig\",\"sourceType\":\"local\",\"content\":$(python3 -c 'import json,urllib.request;content=open("/tmp/cf.yml").read();print(json.dumps(content))'),\"process\":[...]} }"
```

> ⚠️ `PUT` 是**整体替换**一个数组。若一次只想建两个 file，放进同一个数组一次 `PUT`，否则会互相覆盖。

### 3.2 就创建一个分享 token

```bash
# POST /api/token  (payload 必须包在 "payload" 字段里)
curl -X POST http://127.0.0.1:3000/api/token \
  -H 'Content-Type: application/json' \
  -d '{"payload":{"type":"file","name":"Clash-Full"}}'
# → {"status":"success","data":{"token":"..."}}
```

### 3.3 公开分享链接（公网）

分享 URL 形态：`/share/file/{name}?token={token}`，公网主页：
```
https://sub-store.0222999.xyz/share/file/Clash-Full?token=<TOKEN>
```
- token 可选：`?token=` 用 token 解析 SNI（age/access 加密/访问限制）。
- **删除旧 token**：`DELETE /api/token/{token}?type=file&name=<name>`
- 文件改名后**旧 token 失效**，需重建 token。

---

## 4. 坑与注意（实测踩过）

1. **proxy-group 不能用 `include:`（非 mihomo 标准）**必现未定；Use `use`+`filter`。
2. **mihomo 要求任何 proxy-group 必须有 `proxies` 或 `use`**——只用 `include` 不配 `proxies` 会报
   `Use 'proxies' missing configuration`。
3. **`proxy-providers.health-check` 必须带 `enable: true`**，否则报
   `'health-check' has unset fields: enable`。
4. **节点名**：collection 中注入的节点名不带 emoji/后缀（原 Clash `🇺🇸US-D1-1（GLaDOS）`），用
   `filter` / regex 匹配。地区判断靠**节点名前缀**（`US/JP/TW/SG/Fast/Balancer`）。
5. **`filter` 作用于 `use` 的 provider**，不能单独用于空 `proxies` 的组。
6. **`select` 组 = 手动组；`url-test` 组 = 自动组**。用“第1个放 url-test 自动，后面对具体的节点”=
   让每个分组既能自动最低延迟、又能手动锁定。
7. **REALITY VLESS 必须 `mihomo` target**；旧 Clash（Premium）不支持。
8. **token 绑定 type+name**，改名/删除文件后需重建 token，否则分享失效。
9. **勿用 `url`（远程拉取）**注入本地单节点内容，本地节点用 `content`。

---

## 5. 已知的良好实践

- 每个地区一组 `select`（可手动选）+ 一个 `自动-{地区}` `url-test`（自动）。
- 「全部节点」同理 `select(自动+全部use)`。
- 规则网只用**功能组名**（默认节点/下载软件/日本网站/国外AI/YouTube/游戏专用/跟踪分析/广告过滤/国内网站），
  这样增量新增节点不需改 rules。
- `filter` 正则随节点命名调整（当前 GLaDOS 节点前缀 `US/JP/TW/SG/Fast/Balancer/Netflix/Dedicated/X1`）。