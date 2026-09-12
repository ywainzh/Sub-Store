# Sub-Store 订阅导入技术手册（给 Agent / 运维用）

> 目标：任何 agent/脚本可以通过本仓库对**线上已部署的 Sub-Store**（甲骨文 VPS）安全、正确地
> **新增 / 修改 / 删除订阅**，不依赖浏览器和前端界面。

## 0. 前置信息

| 项 | 值 |
| --- | --- |
| Sub-Store 生产服务 | `https://sub-store.0222999.xyz`（公网） |
| Sub-Store 后端 | 通过 Nginx 反代到 `127.0.0.1:3000` |
| 数据文件 | `/opt/sub-store/backend/sub-store.json`（**不要手动改文件**，用 API） |
| 订阅导出目标 | `mihomo`/`ClashMeta`（支持 VLESS+REALITY / Hysteria2）；`Clash`(Premium) **不支持 REALITY** |

> ⚠️ 后端无鉴权（本地安全隔离于 `127.0.0.1`，公网经 Nginx 仅暴露 443）。如从外部访问，
> 注意命令行走代理会串连；测试务必 `--noproxy '*'` 或直接在服务器上 `ssh oracle_vm`。

---

## 1. 通用 API 端点（后端 `127.0.0.1:3000`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/subs` | 列出全部订阅 |
| POST | `/api/subs` | 创建订阅（body=订阅对象） |
| GET | `/api/sub/:name` | 读取单条订阅 |
| PATCH | `/api/sub/:name` | 更新订阅（body 传部分字段即可） |
| DELETE | `/api/sub/:name` | 删除订阅 |
| POST | `/api/preview/sub` | 预览/解析订阅内容（上报节点，不写库） |
| GET | `/download/:name/:target` | 导出某订阅为指定平台（如 `mihomo`） |

> `:name` 需 **URL 编码**（中文名、空格、`/` 都要 encode）。

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
import json, urllib.request, urllib.parse
name = "节点名"
vl = "vless://UUID@服务器:端口?encryption=none&security=reality&sni=www.example.com&fp=chrome&pbk=PUBLIC_KEY&sid=SHORT_ID&type=tcp&headerType=none#节点名"
body = {"name": name, "source": "local", "content": vl, "enable": True, "ignoreFailedRemoteSub": False}
req = urllib.request.Request("http://127.0.0.1:3000/api/subs",
      data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
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
   data=json.dumps(body).encode(), headers={"Content-Type":"application/json"}), timeout=30)
# → data.processed 列表，检查 len>0 和 type
```

导出目标配置（确认参数不丢失，尤其 REALITY 的 `reality-opts`）：
```bash
curl -sS "http://127.0.0.1:3000/download/<urlencode名>/mihomo"
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