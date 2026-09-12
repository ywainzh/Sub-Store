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
  - `VPS-DEPLOY.md` — VPS 部署指南

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

- 本地开发：`bash start.sh [端口]`（默认端口 3000，含前端热重载）
- 生产：`bash start-prod.sh [端口]`（需先构建）
- 前端构建：`cd frontend-local && pnpm build`（已内置 `VITE_API_URL='/'` 同源配置）
- 详细见 `VPS-DEPLOY.md`

## 7. 注意事项

- `.gitignore` 已忽略：`node_modules/`、`dist/`、`backend/root.json`、`backend/sub-store.json`、
  `backend/sub-store.min.js` 等运行数据/构建产物。
- `backend/root.json` 与 `backend/sub-store.json` 是你的私有订阅数据，**不得提交**。
- 提交信息：单行、简要说明变更内容（中文或英文均可）。
