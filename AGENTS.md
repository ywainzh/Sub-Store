# AGENTS.md — 项目协作规则

本文件面向在 `Sub-Store` 项目中工作的 AI 编码 Agent（及开发者本人），
定义本项目的工作约定：**分支策略、代码修改流程、部署方式、以及 GitHub 推送认证细节**。

> 详细分支说明见 [`docs/BRANCH.md`](docs/BRANCH.md)。

---

## 1. 这是什么项目

- **项目**: Sub-Store（高级订阅管理工具，用于 QX / Loon / Surge / Clash / Shadowrocket 等）
- **代码组成**:
  - `backend/` — Node.js 后端（Express），负责订阅转换、节点解析、API
  - `frontend-local/` — 官方前端 `Sub-Store-Front-End`（Vue 3 + Vite），已并入本仓库
  - `start.sh` / `start-prod.sh` — 前后端合并部署启动脚本
  - `deploy/README.md` — 完整 VPS 部署手册（服务器不编译，GitHub Actions 构建发布包）

## 2. 分支策略（最重要）

> ⚠️ **所有开发、修改、推送、发布一律在 `release` 分支上进行。**

- `release` ≡ 唯一开发/发布分支，且是 GitHub 仓库的**默认分支**。
- `master` == 仅继承自上游的保留分支，**不得修改**。
- 远程：
  - `origin`    = `github.com/ywainzh/Sub-Store`（自己的 fork，**可 push**）
  - `upstream`  = `github.com/sub-store-org/Sub-Store`（官方上游，**只作参考、不 push**）

**任何改动前先确保在 `release`**：
```bash
git checkout release
```

## 3. 日常开发 / 提交 / 发布（release）

```bash
git checkout release          # 确保在 release
# ... 修改代码 ...
git add <本次修改的文件>        # 保留工作区里其它已有改动
git commit -m "feat/fix/chore: 说明"
git push origin release       # 保存源码；全新 vX.Y.Z tag 触发正式发布
```

## 4. 人工挑选上游更新（重要）

保留 upstream 供参考，独立构建发布。不自动追踪 latest，不整批合并 upstream/master；按需审阅并人工引入具体修复：

```bash
git checkout release
git fetch upstream master
git log --oneline upstream/master  # 审阅需要的修复
git cherry-pick <明确选中的提交>     # 或人工移植，再通过本项目测试
git push origin release
```

> 注意：仅后端代码来自 `sub-store-org/Sub-Store`；`frontend-local/` 前端来自
> `sub-store-org/Sub-Store-Front-End`，**不会随 upstream 自动更新**，如需更新前端须单独处理。

`release` 禁止强推和删除（对管理员生效），正常直接提交仍允许。发布构建必须检出指定 tag 的提交并验证其属于 release 历史；已发布版本不可覆盖。

## 5. Git 推送认证 / GitHub Token（排障重点）

本机 Git 通过 credential helper（`~/.config/git/credential-github-env.ps1`）
按仓库 owner **自动选 token**，正常 `git push` 无需手动认证。

| 账号 | 仓库 owner | 使用的环境变量 | 对本仓库权限 |
|------|-----------|----------------|--------------|
| `ywain-zh` | `ywain-zh/*` | `GITHUB_TOKEN` | 无 |
| `ywainzh` | **`ywainzh/Sub-Store`** | `GH_TOKEN_YWAINZH`（优先）/ `GITHUB_TOKEN_YWAINZH` | **owner，可 push** |

> **给 AI 助手**：要推送/建分支/建 Release 到 `ywainzh/Sub-Store`，
> **务必使用 `GITHUB_TOKEN_YWAINZH`（`ywainzh` 账号）**。
> 不要误用默认 `GITHUB_TOKEN`（那是 `ywain-zh` 账号，对本仓库无权限，会导致 `invalid_credentials`）。

- 正常推送：`git push origin release`（credential helper 自动完成认证）
- 手动 `gh` 管理（需以 ywainzh 身份）：`GITHUB_TOKEN="$GITHUB_TOKEN_YWAINZH" gh ...`
  - 例：改默认分支 / 建 Release
    ```
    GITHUB_TOKEN="$GITHUB_TOKEN_YWAINZH" gh api -X PATCH repos/ywainzh/Sub-Store -f default_branch=release
    GITHUB_TOKEN="$GITHUB_TOKEN_YWAINZH" gh release create v1.0.0 --target release
    ```

## 6. 部署 / 发布产物

> 完整手册见 [`deploy/README.md`](deploy/README.md)。

- **发布介质**：打版本 tag（`vX.Y.Z`）→ GitHub Actions 自动构建好发布包
  `.github/workflows/release.yml`，并上传到 GitHub Release。
- **服务器绝不编译**：只下载 `sub-store-server-<tag>.tar.gz` 解压 + systemd/pm2 运行。
  运行入口是后端自包含文件：`node backend/dist/sub-store.bundle.js`。
- 本地开发：`bash start.sh [端口]`（默认端口 3000，含前端热重载）
- 生产（如需本地直接跑）：`bash start-prod.sh [端口]`（前端需先构建）
- 前端构建：`cd frontend-local && pnpm build`（已内置 `VITE_API_URL='/'` 同源配置）
- 部署细节见 `deploy/README.md`

## 7. 注意事项

- `.gitignore` 已忽略：`node_modules/`、`dist/`、`backend/root.json`、`backend/sub-store.json`、
  `backend/sub-store.min.js` 等运行数据/构建产物。
- `backend/root.json` 与 `backend/sub-store.json` 是你的私有订阅数据，**不得提交**。
- 提交信息：单行、简要说明变更内容（中文或英文均可）。

## 8. 订阅管理 / 导入（Sub-Store API）

> 完整技术手册（含 API 端点、URL 编码、local/url 两种类型、验证方法、mihomo 导出）
> 见 **[`docs/SUB-IMPORT.md`](docs/SUB-IMPORT.md)**。

- **线上服务**：生产 Sub-Store 部署于甲骨文 VPS，公网 `https://sub-store.0222999.xyz`，
  后端反代到 `127.0.0.1:3000`。管理 API 使用 30 天 Cookie 会话或独立 Bearer API token；分享 token 仅用于 `/share/`。
- 数据存 `/var/lib/sub-store/data`，勿手改文件；认证哈希与会话独立存放，不能进入导出、备份、日志或 Git。
- **在线版本管理**：“我的 → 关于 Sub-Store”，常态两版程序加一份部署前数据快照；服务器不编译。部署助手由 root 管理，应用专用用户无 sudo 权限，详见 `deploy/README.md`。
- **给其他 agent 用**：通过 REST API `POST /api/subs`（创建）、`PATCH /api/sub/:name`（改）、
  `DELETE /api/sub/:name`（删）、`POST /api/preview/sub`（验证解析）。
- **两种来源**：本地单节点用 `source:"local"` + `content`；远程 SJIP 订阅用 `source:"url"` + `url`。
- **两个注意本地协议**：① 带规则的分享配置作为 `file`（mihomoConfig, sourceType:`local`）；
  ② 分发节点来自 `collection` + `Add Proxies From Subscription Operator`。
- VLESS/Hy2节点本地用 `content` 非 `url`；REALITY 必须 `mihomo` target。
- UUID 必须与服务器 xray 的 `clients[0].id` 一致（错一位即超时）。

## 9. Clash 分流规则配置（分享配置 file + 动态节点分组）

> ⚠️ 这是当前你在用的主方案（Clash Verge「Clash-Full」+ 小火箭「Shadowrocket-Nodes」）。
> 完整技术手册见 **[`docs/CLASH-ROUTING.md`](docs/CLASH-ROUTING.md)**；当前分组与刷新方式以 **[`docs/SHARE-REFRESH.md`](docs/SHARE-REFRESH.md)** 为准。

- **要带的完整分流配置** = Sub-Store 里的一个 `mihomoConfig` **file**，`content` 是完整 Clash yaml
  （`mode: rule`, proxy-groups, rules, rule-providers）。
  **必须 `sourceType:"local"`**（`none` 会丢 content）。
- **节点不写死**：文件挂 `process`（`Add Proxies From Subscription Operator`），
  把 `collection`「大海的海」的当前节点**动态写入 `proxies` 顶层**。
- **分组动态 + 自动测速**：注入节点后运行内联 `scripts/dynamic-region-groups.js`，根据本次节点名称自动生成地区、测速组和国旗。
  地区组使用准确节点名称列表，`自动-{地区}`(`url-test`) 放为地区 `select` 组首项；「全部节点」仍使用 `include-all-proxies`。
  无节点的地区组不输出；「日本网站」无 JP 节点时使用 `REJECT`。节点原名不变，未知地区使用独立分组。
  不要再用 HTTP `ocean` 重复拉取同一组合，否则客户端独立缓存会使启停结果滞后。
- **分享链接**：先 `POST /api/token`（`payload:{type:file,name}`）→ `/share/file/<name>?token=<T>`。
  改名/删除文件后旧 token 失效需重建。
- **给 Agent 的踩坑**（详见文档 §4）：
  ① 地区列表由文件后处理脚本生成，不要写死国家列表；不要使用无效的 `include` 字段；
  ② `url-test` 保留测速 URL、interval、tolerance；刷新完整分享后应检查内核中的实际分组；
  ③ `select`=手动、`url-test`=自动；
  ④ 先注入启用节点再生成地区，来源停用和新增地区都应通过原完整分享及客户端验证。
