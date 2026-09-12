# 分支策略与协作说明

本项目采用 **fork + 单分支** 的协作模型：本仓库是 `sub-store-org/Sub-Store` 的 fork，
只维护一个**开发/发布**分支 `release`，其余历史分支（如 `master`）仅保留自上游继承的内容。

---

## 一、分支角色（重要）

| 分支 | 角色 | 说明 |
|------|------|------|
| `release` | **开发 + 发布专用分支**（默认分支） | 你自己的所有代码修改、功能开发、部署发布都在这条分支上进行 |
| `master` | 保留分支 | 仅是 fork 时继承的上游默认分支，**不在其上做任何修改与发布** |
| 上游 `upstream/master` | 上游官方代码 | 只用来同步官方更新，绝不直接推送修改到 upstream |

> 一句话：**你只活在 `release` 分支上**，所有提交、推送、发布都指向并发生在 `release`。

---

## 二、远程仓库配置

本仓库已配置两个远程，**勿删除**：

```bash
origin    https://github.com/ywainzh/Sub-Store.git              # 你自己的 fork（可推送）
upstream  https://github.com/sub-store-org/Sub-Store.git     # 上游官方（只读同步用）
```

> 注意：`origin` 虽然叫 origin，实际是你的 fork（`ywainzh/Sub-Store`）。
> 官方上游用 `upstream` 命名，便于 fetch 同步。

---

## 三、日常开发流程（发布到 release）

> 在 `release` 分支上完成所有，然后 `git push` 即可发布。
> 推送认证会自动使用本地配置的 credential helper 与对应 GitHub Token（见下文）。

```bash
# 1. 确保在 release 分支
git checkout release

# 2. 编写/修改代码...

# 3. 提交所有改动
git add -A
git commit -m "feat/fix: 变更说明"

# 4. 推送到自己的远程 release 分支（= 发布）
git push origin release
```

---

## 四、同步上游官方更新

由于本仓库是 fork，官方 `Sub-Store` 会有新功能/Bugfix。需要把上游改动合入自己的
`release` 分支时，按以下步骤（**在 release 分支上执行**）：

```bash
# 1. 切到 release
git checkout release

# 2.（建议）把本地改动先提交或 stash，保证工作区干净
git status

# 3. 拉取上游官方 master
git fetch upstream master

# 4. 把上游改动合并到本地 release（合并到当前分支）
git merge upstream/master

# 5. 若有冲突，手动解决后：
#    git add <解决冲突的文件>
#    git commit -m "merge: 同步上游 upstream/master 到 release"

# 6. 推送更新后的 release 到自己的远程
git push origin release
```

> 注意：`frontend-local/` 来自官方**前端**仓库 `sub-store-org/Sub-Store-Front-End`，
> 与后端 `upstream/master` 不同源，同步上游时**不会自动包含**前端更新。
> 若需更新前端到与官方最新版一致，需从该前端仓库重新拉取/合并，建议单独手工处理。

### 遇到冲突的简单处理
- 冲突文件会在 `git status` 中标 `UU`，Git 会写入 `<<<<<<<` / `=======` / `>>>>>>>` 标记
- 手动保留正确内容后，`git add` 该文件，再 `git commit` 完成合入
- 涉及后端数据文件（`backend/root.json`、`backend/sub-store.json`）都已被 `.gitignore` 忽略，不会冲突

---

## 五、GitHub Token（Git 推送认证）

### 本机已有两组 Token 环境变量，对应两个不同账号

本机的 Git 已配置 credential helper（`~/Config/git/credential-github-env.ps1`），
会根据仓库 owner（路径中的用户名）**自动选择正确的 Token**，`git push` 时无需手动输入。

| 账号 | 对应仓库 owner | 使用的 Token 环境变量 | 在 Sub-Store 的权限 |
|------|----------------|------------------------|----------------------|
| `ywain-zh` | `ywain-zh/*` | `GITHUB_TOKEN` | 无权限（非本仓库 owner） |
| `ywainzh` | `ywainzh/*` | `GH_TOKEN_YWAINZH`（优先）| **本仓库 `ywainzh/Sub-Store` 的 owner，可 push** |
| | | `GITHUB_TOKEN_YWAINZH`（备选）| 同上 |

> 关键：**写权限在 `ywainzh` 账号**（仓库 `ywainzh/Sub-Store` 的所有者）。
> 你配置的 helper 会在访问 `github.com` 且 owner 为 `ywainzh` 时，自动读取 `GITHUB_TOKEN_YWAINZH`。
> 若遇到 `invalid credentials / Authentication failed`，大概率是 helper 未取到变量，
> 请先确认 `$GITHUB_TOKEN_YWAINZH` 存在且未过期。

### 若需手动显式认证（不推荐，仅排障用）

```bash
# 方式 A：临时代入（只对当前命令有效，不落盘）
GITHUB_TOKEN="$GITHUB_TOKEN_YWAINZH" git push origin release
# 或
git -c http.extraHeader="Authorization: token $GITHUB_TOKEN_YWAINZH" push origin release

# 方式 B：HTTP 带凭据 URL（一次性，不写入 config；注意不要把它存进仓库内）
git push "https://ywainzh:${GITHUB_TOKEN_YWAINZH}@github.com/ywainzh/Sub-Store.git" release
```

> ⚠️ 生产/共享环境请使用系统凭据管理器或 Git credential helper，不要在 shell 历史或仓库里保存 token。

### GitHub API / gh 命令认证

命令行里用 `gh` 时，默认使用活动账号（`GITHUB_TOKEN` → `ywain-zh`）。
若需以 `ywainzh` 身份管理 `ywainzh/Sub-Store`（如改默认分支、建 Release），
覆盖 `GH_TOKEN` 变量即可：

```bash
# 用 ywainzh 账号身份执行 gh
GH_TOKEN="$GITHUB_TOKEN_YWAINZH" gh api repos/ywainzh/Sub-Store ...
```

---

## 六、部署（发布到 release 后）

- 本地开发 / 测试：`bash start.sh`
- VPS 生产部署：见 `VPS-DEPLOY.md`（`bash start-prod.sh`，同步用 git fetch + checkout release）

发布到 GitHub 的 Release / Tag 时，统一基于 `release` 分支：
```bash
gh release create v1.0.0 --target release --generate-notes   # 以 ywainzh 身份：GH_TOKEN="$GITHUB_TOKEN_YWAINZH"
```