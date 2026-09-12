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
  - `upstream`  = `github.com/sub-store-org/Sub-Store`（官方上游，**只同步、不 push**）

**任何改动前先确保在 `release`**：
```bash
git checkout release
```

## 3. 日常开发 / 提交 / 发布（release）

```bash
git checkout release          # 确保在 release
# ... 修改代码 ...
git add -A
git commit -m "feat/fix/chore: 说明"
git push origin release       # 即发布（同步后自动认证推送）
```

## 4. 同步上游官方更新（重要）

fork 需定期把官方更新合入 release：

```bash
git checkout release
git fetch upstream master
git merge upstream/master     # 把官方 master 合入 release
# 有冲突则：git add <冲突文件> && git commit -m "merge: sync upstream/master"
git push origin release
```

> 注意：仅后端代码来自 `sub-store-org/Sub-Store`；`frontend-local/` 前端来自
> `sub-store-org/Sub-Store-Front-End`，**不会随 upstream 自动更新**，如需更新前端须单独处理。

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
  后端反代到 `127.0.0.1:3000`（后端无鉴权，数据存 `backend/sub-store.json`，勿手改文件）。
- **给其他 agent 用**：通过 REST API `POST /api/subs`（创建）、`PATCH /api/sub/:name`（改）、
  `DELETE /api/sub/:name`（删）、`POST /api/preview/sub`（验证解析）。
- **两种来源**：本地单节点用 `source:"local"` + `content`；远程 SJIP 订阅用 `source:"url"` + `url`。
- **两个注意本地协议**：① 带规则的分享配置作为 `file`（mihomoConfig, sourceType:`local`）；
  ② 分发节点来自 `collection` + `Add Proxies From Subscription Operator`。
- VLESS/Hy2节点本地用 `content` 非 `url`；REALITY 必须 `mihomo` target。
- UUID 必须与服务器 xray 的 `clients[0].id` 一致（错一位即超时）。

## 9. Clash 分流规则配置（分享配置 file + 动态节点分组）

> ⚠️ 这是当前你在用的主方案（Clash Verge「Clash-Full」+ 小火箭「Shadowrocket-Nodes」）。
> 完整技术手册见 **[`docs/CLASH-ROUTING.md`](docs/CLASH-ROUTING.md)**。

- **要带的完整分流配置** = Sub-Store 里的一个 `mihomoConfig` **file**，`content` 是完整 Clash yaml
  （`mode: rule`, proxy-groups, rules, rule-providers）。
  **必须 `sourceType:"local"`**（`none` 会丢 content）。
- **节点不写死**：文件挂 `process`（`Add Proxies From Subscription Operator`），
  把 `collection`「大海的海」的当前节点**动态写入 `proxies` 顶层**。
- **分组动态 + 自动测速**：proxy-groups 用 `proxy-providers.ocean`（HTTP 指向共享订阅），
  分区组 `type: select` + `use:[ocean]` + `filter`(正则按前缀归区)，
  并把 `自动-{地区}`(`url-test`) 放为首项 → 自动选最低延迟；其余节点手动可选。
- **分享链接**：先 `POST /api/token`（`payload:{type:file,name}`）→ `/share/file/<name>?token=<T>`。
  改名/删除文件后旧 token 失效需重建。
- **给 Agent 的踩坑**（详见文档 §4）：
  ① proxy-group 用 `use`+`filter`，不要 `include`（mihomo 必报 missing proxies）；
  ② health-check 必须 `enable: true`；
  ③ `select`=手动、`url-test`=自动；
  ④ 节点名不带 emoji/后缀，按前缀 `US/JP/TW/SG/...` 过滤。
