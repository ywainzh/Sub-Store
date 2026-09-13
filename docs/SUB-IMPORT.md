# Sub-Store 订阅导入技术手册（给 Agent / 运维用）

> 目标：任何 agent/脚本可以通过本仓库对**线上已部署的 Sub-Store**（甲骨文 VPS）安全、正确地
> **新增 / 修改 / 删除订阅**，不依赖浏览器和前端界面。

## 0. 前置信息

| 项 | 值 |
| --- | --- |
| Sub-Store 生产服务 | `https://sub-store.0222999.xyz`（公网） |
| Sub-Store 后端 | 通过 Nginx 反代到 `127.0.0.1:3000` |
| 数据文件 | `/var/lib/sub-store/data/sub-store.json`（**不要手动改文件**，用 API） |
| 订阅导出目标 | `mihomo`/`ClashMeta`（支持 VLESS+REALITY / Hysteria2）；`Clash`(Premium) **不支持 REALITY** |

管理 API、数据导出与普通下载均要求认证，包括本机回环请求。自动化使用独立的
`Authorization: Bearer` API token；分享 token 只用于 `/share/`，不能管理订阅。
在执行环境中安全注入 `SUB_STORE_API_TOKEN`，不要把真实值写入脚本、命令历史、日志或 Git。
服务器只保存 token 哈希，不能从服务器认证文件反查明文；凭据交付与轮换见 [部署手册](../deploy/README.md)。
下列示例中的环境变量必须由执行脚本的环境提供；SSH 不会自动转发本机环境变量。
如从外部访问，注意命令行走代理会串连；测试可用 `--noproxy '*'` 或直接在服务器上执行。

---

## 1. 通用 API 端点（后端 `127.0.0.1:3000`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/subs` | 列出全部订阅 |
| GET | `/api/subs/status` | 本地读取单条及组合的实际启用状态，不访问供应商 |
| POST | `/api/subs` | 创建订阅（body=订阅对象） |
| GET | `/api/sub/:name` | 读取单条订阅 |
| PATCH | `/api/sub/:name` | 更新订阅，可传 `enabled`、`autoManage` 等部分字段 |
| POST | `/api/sub/:name/check` | 立即检查已保存来源，绕过旧流量缓存，返回状态及套餐信息 |
| PATCH | `/api/collection/:name` | 更新组合，`enabled` 控制整体启停 |
| DELETE | `/api/sub/:name` | 删除订阅 |
| POST | `/api/preview/sub` | 预览/解析订阅内容（上报节点，不写库） |
| GET | `/download/:name/:target` | 导出某订阅为指定平台（如 `mihomo`） |

> `:name` 需 **URL 编码**（中文名、空格、`/` 都要 encode）。

### 启停与自动检测（v0.1.2 起）

`enabled` 是手动意愿，默认 `true`；远程订阅 `autoManage` 默认 `true`，纯本地订阅只支持手动启停。关闭自动检测可手动启用已到期的来源。两个字段只接受布尔值。运行状态由后端维护，不能通过导入或 PATCH 的 `active`、`reason` 等字段覆盖。

```json
{"enabled": false}
```

把以上 JSON PATCH 到单条或组合接口即可暂停输出。单条停用保留配置、组合成员关系和分享 token；组合会排除该条并继续输出其他可用节点。单条自身及整体关闭的组合下载／分享返回 `409`，重新启用后原分享链接恢复。文件页没有独立开关，文件来源和节点注入遵循同一规则。管理读取、配置导出和单条调试预览仍然可用。

状态接口返回 `data.subscriptions` 和 `data.collections`。每项包含 `name`、`enabled`、`active`、`reason`、`checkedAt`、`availableSources`、`sourceCount`、`partial`；组合还有 `firstAvailable`，单条还有 `autoManage` 和按 URL 顺序排列的 `sources`。`reason` 为 `manual`、`expired`、`exhausted`、`empty` 或 `null`，时间为毫秒时间戳。来源的 `flow.expires` 使用秒时间戳，`flow.total` 与 `flow.usage` 使用字节；仅返回供应商提供的合法字段。

检测间隔为 30 分钟，最多两条来源并发。手动关闭项不定期检查，自动停用项继续检查以便恢复。下载前复用最近检测，过期才刷新；`POST /api/sub/:name/check` 可立即重查已保存来源。查询参数 `noFlow` 不绕过启停规则。已保存的 `noFlow` 配置仍表示不查询套餐信息；无法获得信息的来源不会被新判为额度用尽。

多个 URL 分别判断，混合本地内容保留。有效到期时间已到或合法正总额度被上传／下载之和用尽才自动停用；缺失、负数、非法值、零额度和网络失败不能解除已有停用判定。恢复须取得相关限制解除的新信息。组合不以首个成员的流量决定整组状态，仅用首个实际可用来源的流量做显示和透传。

Clash／小火箭在下次更新订阅时同步节点变化。旧版 **v0.1.1 及更早版本不执行这些启停规则**，回退旧版可能重新输出已停用来源。

---

## 2. 订阅的两种核心类型

| `source` | 含义 | 节点来源字段 | 典型用法 |
| --- | --- | --- | --- |
| `"local"` | 本地手动录入 | `content`（放分享链接/节点文本） | 手填单节点（VLESS/Hysteria2/Vmess 等）|
| `"url"` | 远程 URL | `url`（远程地址，去拉取） | 机场/远程 SJIP 链接 |

> 关键坑：**用 `source:"local"` 时，VLESS/Hy2 节点要放进 `content`，不要用 `url`。**
> 若把 vless 放进 `source:"url"` 的 `url` 字段，Sub-Store 会把它当远程 HTTP 订阅去下载 → 报 500。

---

## 3. 导入一个「本地单节点」订阅（eg. VLESS+REALITY）

```bash
ssh oracle_vm 'python3 - <<PY
import json, os, urllib.request, urllib.parse
name = "节点名"
vl = "vless://UUID@服务器:端口?encryption=none&security=reality&sni=www.example.com&fp=chrome&pbk=PUBLIC_KEY&sid=SHORT_ID&type=tcp&headerType=none#节点名"
body = {"name": name, "source": "local", "content": vl, "enabled": True, "ignoreFailedRemoteSub": False}
req = urllib.request.Request("http://127.0.0.1:3000/api/subs",
      data=json.dumps(body).encode(), headers={"Content-Type":"application/json", "Authorization": "Bearer " + os.environ["SUB_STORE_API_TOKEN"]})
print(urllib.request.urlopen(req, timeout=12).read().decode())
PY'
```

### Hysteria2 单节点（同上结构，`content` 用 hy2 URI）
```
hysteria2://密码%2B编码@服务器:8443?sni=服务器域名&alpn=h3#节点名
```
> 密码里的 `+` 要 URL 编码为 `%2B`；否则分节可能被拆错。

---

## 3. 使用一个「远程 URL 订阅」（例. GLaDOS / 订阅）

```bash
# 服务器上执行
curl -sS -X POST http://127.0.0.1:3000/api/subs \
  -H "Authorization: Bearer $SUB_STORE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"glados","source":"url","url":"https://update.glados-config.com/.../glados.yaml","enable":true}'
```

---

## 4. 验证解析是否正确（必做！）

创建后**务必预览**，确认能解析出预期节点，避免静默引入错误：

```python
body = {"name": "订阅名", "source": "url"/"local",
        "content"/"url": "...", "enable": True}
# 服务器上
urllib.request.urlopen(urllib.request.Request(
   "http://127.0.0.1:3000/api/preview/sub",
   data=json.dumps(body).encode(), headers={"Content-Type":"application/json", "Authorization": "Bearer " + os.environ["SUB_STORE_API_TOKEN"]}), timeout=30)
# → data.processed 列表，检查 len>0 和 type
```

导出目标配置（确认参数不丢失，尤其 REALITY 的 `reality-opts`）：
```bash
curl -sS -H "Authorization: Bearer $SUB_STORE_API_TOKEN" "http://127.0.0.1:3000/download/<urlencode名>/mihomo"
```

---

## 5. 从公网（本地 / 笔记本 / 其他 agent）倒转

先学会跳过本机代理（Clash 会劫持 `127.0.0.1:7897`）：
```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
```

远程排版：也可直接对公网 `https://sub-Store.0222999.xyz/api/...` 发请求（但要留意 CORS / 走反代）。

---

## 6. 重要事项与踩坑记录

- **UUID 必须和服务器 xray 完全一致**：导入 VLESS 节点时，客户端靠 UUID 匹配用户。
  错一位就 → 连接超时（误认为节点坏）。
  核对方法：`ssh oracle_vm && cat /usr/local/etc/xray/config.json` 看 `clients[0].id`。
- **REALITY 必须用 mihomo/ClashMeta 目标**，普通 Clash(Premium) 不支持 → 连 REJECT/超时。
- **`port: 2096`** 是甲骨文 xray 服务器 GoNode move 后的真实端口（原来 443 现在是 Nginx/SubStore）。
- 本地单节点放 `content`，远程订阅放 `url`；两者勿混。
- 改订阅用 PATCH（`{ "content": "...", "name": ... }`），别重复 POST（会 Duplicate key）。

---

## 7. 一键部署工具（便于 Agent 复用）

下面封了一个自包含 Python 脚本的「导入/验证」片段，接收 `type`(`local`/`url`)+名称+内容(链接或url)，完成创建并打印解析结果：

（如需要，可抽出为 `scripts/import_sub.py` 供其他 agent 调用。）
