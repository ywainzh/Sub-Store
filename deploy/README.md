# Sub-Store 独立部署与版本管理

前后端统一使用 `ywainzh/Sub-Store` 的 GitHub Release。服务器只下载、校验和运行发布包，不安装 pnpm、不编译源码。Node 构建版本固定为 `.node-version` 中的 24.15.0；服务器使用 Node 24，版本不低于此值。

## 发布

所有开发在 `release`；`master` 保留。旧 `build` 工作流已停用并从 `release` 移除，`release` 禁止强推和删除，对管理员也生效，允许正常直接提交。

1. 在 `release` 完成改动，只暂存本次修改的文件，提交并正常推送。
2. 创建全新的正式 tag，例如 `git tag -a v0.1.0 -m "Sub-Store v0.1.0"`，再推送该 tag。
3. 等待 `build & release server tarball` 完成。手动触发时同样必须填写已存在的 `vX.Y.Z` tag。

流程验证 tag 对应提交属于 `release` 历史，检出该提交，使用 Node 24.15.0、pnpm 11.0.9 和两个 `pnpm-lock.yaml` 执行冻结安装。后端测试、管理/部署测试、前端语言检查、类型检查、构建及完整包启动检查全部通过后才发布。已有 Release（包括草稿）不可覆盖；失败的草稿须检查原因后人工处理，不能重用已正式发布的版本号。

每个版本包含：

- `sub-store-server-<tag>.tar.gz`：自包含后端、前端、部署工具及开源许可证。
- `release-manifest.json`：项目 tag、commit、前后端自身版本、测试 Node 版本、数据格式与管理/认证协议版本。
- `checksums.txt`：发布包与独立清单的 SHA-256。

构建与部署不跟踪上游 latest，也不动态安装依赖。保留 `upstream` 供人工挑选修复；详见 [分支说明](../docs/BRANCH.md)。

## 服务器布局与权限

| 路径 | 内容与权限 |
| --- | --- |
| `/opt/sub-store/releases/<tag>` | root 管理的程序目录，常态最多两版 |
| `/opt/sub-store/current` | root 管理的当前版本符号链接 |
| `/var/lib/sub-store/data` | `substore` 用户可写的 `sub-store.json` 与 `root.json` |
| `/etc/sub-store/auth.json` | 管理员密码哈希、API token 哈希和会话撤销版本；root 可写、应用只读 |
| `/var/lib/sub-store-auth/sessions.json` | 独立会话状态，不参与版本或数据回退 |
| `/etc/sub-store/app.env` | 生产环境配置，root 管理 |
| `/etc/sub-store/deploy.json` | 部署助手固定配置，root 管理 |
| `/var/lib/sub-store-deploy/inbox` | 应用提交受限部署请求的目录 |
| `/var/lib/sub-store-deploy/state` | root 写入的任务状态和安装记录，应用只读；最多保留 20 个小型任务记录 |
| `/var/lib/sub-store-deploy/snapshot` | 唯一数据快照，仅包含两个数据文件与校验信息 |
| `/var/lib/sub-store-deploy/work` | 事务临时目录，完成后清理 |
| `/usr/local/lib/sub-store` | root 管理的部署助手，不随应用回退 |

应用以专用 `substore` 用户运行，无 sudo 权限。`sub-store-deploy.path` 观察固定请求文件并启动唯一的 `sub-store-deploy.service`；后台只提交 UUID、合法版本 tag 和是否恢复快照，不接受命令、路径或下载 URL。助手用 `flock` 互斥、持久化事务，应用重启不影响它，机器重启或助手中断后会继续完成清理或恢复。

不增加定时备份。常态是当前版、上一版和一份部署前数据快照；下载与切换期间允许暂存候选版本。认证状态、systemd 日志和程序不进入数据快照。

## 首次安装或从 v0.0.1 迁移

前置条件：Ubuntu/Debian、Node 24、systemd、Nginx HTTPS，现有站点配置在 `/etc/nginx/sites-available/sub-store`，域名与命令参数一致。应用监听 `127.0.0.1:3000`。当前安装器专用于这套固定服务器布局；其它路径须先调整并审阅安装器，不能将任意路径传给网页部署接口。

先在本机、仓库外创建仅自己可读的私有目录，用已检出的发布代码生成凭据：

```bash
umask 077
PRIVATE_DIR="$HOME/.local/share/sub-store-private"
mkdir -p "$PRIVATE_DIR"
node deploy/auth-cli.cjs init --auth-file "$PRIVATE_DIR/auth.json" --output "$PRIVATE_DIR/credentials.json"
```

`credentials.json` 包含随机初始密码和独立 API token，账号固定为 `admin`。不要复制到仓库、聊天、日志或服务器数据目录。Windows 使用私有目录的 NTFS ACL 限制读取；不要仅依赖 POSIX 文件模式。

将 `auth.json`（只有哈希）和当前已审核的部署工具上传至服务器私有临时目录，保持以下结构：

```text
sub-store-bootstrap/
├── auth.json
├── deploy/                    # 本项目 deploy 目录
└── backend/src/management/    # 本项目对应目录
```

服务器执行（安装过程无编译）：

```bash
sudo install -d -m 0750 /etc/sub-store
sudo install -o root -g root -m 0600 /home/ubuntu/sub-store-bootstrap/auth.json /etc/sub-store/auth.json
sudo node /home/ubuntu/sub-store-bootstrap/deploy/install.cjs v0.1.0 https://sub-store.0222999.xyz
```

安装器从固定公开仓库下载并检查 SHA-256、USTAR 路径、包内外清单与兼容性，拒绝链接、设备文件和越界路径。它创建专用用户，将程序、数据与认证分离，安装 systemd 服务。迁移期间 Nginx 暂时封闭 `/api` 和 `/download`，分享入口保持独立 token 校验。停止旧服务取得一致快照后切换新版本，通过健康、匿名管理拒绝和现有分享检查后才重新开放管理入口。

首次迁移保留 `v0.0.1` 程序作为 SSH 应急版本，网页不会列出它。首次正常网页升级成功后，它会按“两版”策略被清理。不要重复运行安装器覆盖已安装目录。

生产配置必须明确设置 `NODE_ENV=production`、`SUB_STORE_AUTH_ENABLED=true`、`SUB_STORE_AUTH_FILE`、`SUB_STORE_AUTH_SESSIONS_FILE`、`SUB_STORE_PUBLIC_ORIGIN=https://你的域名`。缺失/损坏凭据、错误路径或生产禁用认证都会拒绝启动。

## 登录、自动化与凭据轮换

浏览器使用 `HttpOnly`、生产 `Secure`、`SameSite=Strict` Cookie。会话固定 30 天到期，不因访问续期，重启服务后保留；退出仅撤销当前会话。重置密码撤销全部浏览器会话，轮换 API token 不影响浏览器会话。最多保留 32 个未过期会话。

自动化只通过请求头认证，不接受查询参数中的管理 token：

```bash
curl -fsS -H "Authorization: Bearer $SUB_STORE_API_TOKEN" https://sub-store.0222999.xyz/api/subs
```

`SUB_STORE_API_TOKEN` 由本机私有凭据文件读取到当前进程，禁止输出或提交其值。普通订阅客户端继续使用 `/share/...?...token=...` 的分享链接。分享 token 不能管理订阅。

所有浏览器管理 API（包括旧的 GET 操作）校验 CSRF；自动化 Bearer 请求不依赖 Cookie/CSRF。`GET /api/auth/status` 可获取当前会话的 CSRF 值，供本站前端后续发送 `X-CSRF-Token`。登录有每 IP 和全局限流。对 Nginx 的信任只限本机回环地址。

在本机私有目录接收服务器生成的新凭据，服务器仍只保留哈希：

```bash
umask 077
ssh oracle_vm 'sudo node /usr/local/lib/sub-store/deploy/auth-cli.cjs reset-password --output -' > "$PRIVATE_DIR/new-password.json"
ssh oracle_vm 'sudo node /usr/local/lib/sub-store/deploy/auth-cli.cjs rotate-api-token --output -' > "$PRIVATE_DIR/new-api-token.json"
```

两条命令分别撤销旧密码会话/旧 API token，立即生效，无需重启。不要直接运行 `--output -` 将凭据打印到公共终端。

## 网页更新与回退

打开“我的 → 关于 Sub-Store”。版本更新列出本项目最新兼容正式 Release 与更新说明；版本回退可分页选择兼容历史版本，标记本地上一版。远程版本按需下载，不预先缓存所有程序。GitHub 暂时不可用时，本地兼容上一版仍可回退。

部署阶段：检查版本 → 下载 → 校验 → 准备 → 停止服务 → 一致快照 → 切换 → 启动 → 健康检查 → 清理。重复请求返回 `409`，任务 ID 和结果持久化，刷新页面或断网不取消任务。服务重启时界面显示等待连接，成功后清理旧 PWA 资源并显示真实项目版本；后端 `env.version` 与前端自身版本保留原本的兼容判断含义。

默认回退保留最新订阅数据。只有唯一快照的版本与目标 tag 一致时，才提供“同时恢复数据快照”；需要显式勾选，快照之后的订阅修改会被替换。目标不能读取当前数据格式且没有匹配快照时拒绝回退。健康检查失败时恢复本次操作之前的程序和两个数据文件，失败状态不会标记成功。

| 接口 | 行为 |
| --- | --- |
| `POST /api/auth/login` | `{username:"admin",password}` 建立会话 |
| `GET /api/auth/status` | 认证能力、登录状态与当前 CSRF 值 |
| `POST /api/auth/logout` | 撤销当前会话 |
| `GET /api/system/versions?page=1` | 当前/上一版、兼容 Release、快照信息、进行中任务 |
| `POST /api/system/deployments` | `{tag:"vX.Y.Z",restoreData:false}`，返回 `202` 与任务 ID |
| `GET /api/system/deployments/:id` | 实际阶段、成功/失败及恢复结果 |
| `GET /api/health` | 无敏感信息的就绪状态、项目 tag 和认证能力 |

除登录、认证状态和健康检查外，管理接口均需认证。返回格式沿用 `{status:"success",data:...}` 或 `{status:"failed",error:...}`。

## 故障与应急

```bash
sudo systemctl status sub-store sub-store-deploy.path
sudo journalctl -u sub-store-deploy -n 40 --no-pager
curl -fsS http://127.0.0.1:3000/api/health
```

任务显示 `recovery-required` 时应检查磁盘、目录权限和服务日志；保留 `state/transaction.json` 与事务临时快照，不要手动删除。修复外部问题后启动 `sub-store-deploy.service`，它会优先恢复未完成事务。

只有首次迁移应急且 `/opt/sub-store/releases/v0.0.1` 仍存在时，才允许通过 SSH：

```bash
sudo node /usr/local/lib/sub-store/deploy/emergency-legacy.cjs
```

此命令先封闭公网管理入口，再停止网页部署、恢复 v0.0.1 程序，默认保留当前数据。只有快照对应 v0.0.1 时才能追加 `--restore-snapshot`。分享继续校验原 token，认证文件保留。重新恢复新版认证并验证前，不要手工打开 Nginx 管理 gate。
