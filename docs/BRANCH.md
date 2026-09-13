# 分支、上游与独立发布

`release` 是唯一开发和发布分支，也是默认分支；`master` 仅保留上游历史，不修改、不发布。

| 远程 | 用途 |
| --- | --- |
| `origin` → `https://github.com/ywainzh/Sub-Store.git` | 本项目，可正常推送 `release` 与新的正式 tag |
| `upstream` → `https://github.com/sub-store-org/Sub-Store.git` | 官方后端参考，只读取 |

保留 upstream，不自动合并、不跟踪最新发行物。需要官方修复时，先 `git fetch upstream master`，审阅具体提交，再在 `release` 人工移植或 `git cherry-pick <明确的提交>`。前端来源为 `sub-store-org/Sub-Store-Front-End`，同样按需人工引入；前后端随后通过本项目统一测试和打包。

`release` 禁止强推与删除，包括管理员。允许正常直接提交，无强制 PR 流程。修改前检查当前分支与工作区，准确暂存本次文件，不把已有用户改动或私有数据一起提交。

```bash
git switch release
git status
git add <本次修改的文件>
git commit -m "feat: describe the change"
git push origin release
git tag -a v0.1.0 -m "Sub-Store v0.1.0"
git push origin v0.1.0
```

推送 `release` 只保存源码，推送新的 `vX.Y.Z` tag 才发布。版本号不可复用，已发布版本和资产不可覆盖；手动工作流必须指定已有 tag，构建该 tag 的确切提交并检查它属于 `release` 历史。详情见 [部署手册](../deploy/README.md)。

## GitHub 认证

本仓库 owner 是 `ywainzh`，使用 `GH_TOKEN_YWAINZH`，不可用时使用 `GITHUB_TOKEN_YWAINZH`。`GITHUB_TOKEN` 属于另一个账号 `ywain-zh`，不能用于本仓库写入。已有 credential helper 可按 owner 选择 token。

显式 HTTPS 推送必须为单条 Git 命令设置 `http.https://github.com/.extraheader`，禁止把凭据嵌入 URL、配置文件、日志或提交。使用 `gh` 时仅在当前进程将正确账号的凭据映射至 `GH_TOKEN`；不要输出凭据。遇到 `403` 先检查 owner 与账号是否一致。

服务器下载公开 Release 不需要 GitHub token。管理 API token 是另一套由本项目生成的凭据，仅用于部署后的管理接口，不能与 GitHub token 混用。
