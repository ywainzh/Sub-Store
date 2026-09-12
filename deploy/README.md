# Sub-Store 服务器部署手册

本手册面向把 Sub-Store（后端 + 官方前端）部署到一台 Linux VPS。
**核心原则：服务器绝不编译任何代码（不跑 node/pnpm/esbuild/vite），只拉取 GitHub Release
发布的、已经构建好的完整运行包，解压后由 systemd/pm2 守护运行。**

> 发布流程见本文件「发布新版本」和仓库根目录 `docs/BRANCH.md`、`AGENTS.md`。

| 项目 | 固定值 |
| --- | --- |
| 仓库 | `github.com/ywainzh/Sub-Store` |
| 发布分支 | `release` |
| 发布包 | GitHub Release 中的 `sub-store-server-<tag>.tar.gz` |
| 部署目录 | `/opt/sub-store` |
| 应用监听 | `127.0.0.1:3000`（默认，可改） |
| 公网域名 | （你的域名，示例 `sub.example.com`） |
| 数据目录 | `/opt/sub-store/backend/`（运行时生成 `sub-store.json`、`root.json`，见备份一节） |

---

## 1. 发布流程（在本地/GitHub，不在服务器）

所有代码在 `release` 分支；提交并打 tag 后，`GitHub Actions` 自动构建发布包。

```bash
git switch release
git pull --ff-only origin release
git status                  # 应干净

# 提交你的改动
git add -A
git commit -m "feat/fix: 说明"
git push origin release

# 确认后打版本 tag（每次全新、不可复用）
git tag -a vX.Y.Z -m "Sub-Store vX.Y.Z"
git push origin vX.Y.Z
```

在 GitHub Actions 确认「build & release server tarball」工作流成功，然后 GitHub Release
页面会生成：
- `sub-store-server-vX.Y.Z.tar.gz`（完整运行包）
- `checksums.txt`（校验和）

> 服务器不需要 GitHub Token；镜像/包公开可拉取。CI 在 GitHub 上完成所有编译。

### 版本规则

- 二开版本从 `v0.1.0` 起，按补丁递增：`v0.1.0 → v0.1.1 → ...`
- 每次发布必须使用全新 `vX.Y.Z`；不要复用/强推/删除已发布 tag。
- 日常小修、上游同步递增最后一位（如 `v0.1.1`）；规划了新功能阶段才升中间位。
- 不要用 `latest`、`release-*`、日期命名 tag。

---

## 2. 服务器前置条件

- 一台 Linux VPS（Ubuntu 20.04+ / Debian 11+ / CentOS 8+）
- 已安装 **Node.js 24.x**（`dist/sub-store.bundle.js` 需要在 Node 22+ 正常运行，建议用 24.15.0）
  - 只用运行时链路，不需要 pnpm、不需要任何构建工具
- 已安装 `systemd`（Ubuntu/Debian/CentOS 自带）
- （推荐）`pm2` 可选进程守护，二选一即可
- 代理选做：Nginx + Certbot（HTTPS）

> Node 安装方式（服务器只需 node runtime，无需编译）：
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
> sudo apt-get install -y nodejs
> # 或直接用 nvm 安装仓库要求的 24.15.0
> # curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
> # nvm install 24.15.0 && nvm use 24.15.0
> ```

---

## 3. 第一次部署

### 3.1 下载并校验发布包

以下以 `v0.1.0` 为例；实际替换为本次 tag。

```bash
export TAG=v0.1.0
export DIR=/opt/sub-store
export RELEASE=https://github.com/ywainzh/Sub-Store/releases/download/${TAG}

sudo install -d -m 0755 "${DIR}"
cd "${DIR}"

# 下载
curl -fsSL "${RELEASE}/sub-store-server-${TAG}.tar.gz" -o /tmp/sub-store-server.tar.gz
curl -fsSL "${RELEASE}/checksums.txt" -o /tmp/sub-store-checksums.txt

# 校验
expected=$(grep "sub-store-server-${TAG}.tar.gz" /tmp/sub-store-checksums.txt | awk '{print $1}')
actual=$(sha256sum /tmp/sub-store-server.tar.gz | awk '{print $1}')
test -n "${expected}"
test "${expected}" = "${actual}"

# 安全检查 + 解压
tar -tzf /tmp/sub-store-server.tar.gz | grep -Eq '(^/|(^|/)\.\.(/|$))' && exit 1 || true
sudo tar -xzf /tmp/sub-store-server.tar.gz -C "${DIR}" --strip-components=1
```

解压后的目录结构：

```
/opt/sub-store/
├── backend/
│   └── dist/
│       ├── sub-store.bundle.js      # Node 后端运行入口（自包含）
│       ├── runtime-manifest.json
│       └── sub-store-0.min.js
│       └── sub-store-1.min.js
│       └── sub-store-parser.loon.min.js
│       └── proxy-utils.esm.mjs
├── frontend/                        # 前端静态资源
└── data/                            # （首次运行自动创建）
```

> 目录归 server 用户所有，注意权限：
> ```bash
> sudo chown -R "$(id -u):$(id -g)" "${DIR}"
> ```

### 3.2 配置环境变量

创建环境变量文件 `/opt/sub-store/.env`（存运行时配置）：
```
SUB_STORE_BACKEND_API_PORT=3000
SUB_STORE_BACKEND_API_HOST=127.0.0.1
SUB_STORE_BACKEND_MERGE=ON
SUB_STORE_FRONTEND_BACKEND_PATH=/
SUB_STORE_FRONTEND_PATH=/opt/sub-store/frontend
# 只允许你自己的站点来源；公网必须给真实域名，禁止 *
SUB_STORE_CORS_ALLOWED_ORIGINS=https://sub.example.com
```
> `.env` 含可能的私有信息，`chmod 600`；不要提交到 Git。

### 3.3 systemd 服务（推荐）

创建 `/etc/systemd/system/sub-store.service`：

```ini
[Unit]
Description=Sub-Store Subscription Manager
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/sub-store/backend
EnvironmentFile=/opt/sub-store/.env
ExecStart=/usr/bin/node dist/sub-store.bundle.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启动并开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sub-store
sudo systemctl status sub-store
```

验证：
```bash
curl -fsS http://127.0.0.1:3000/                  # 前端 HTML
curl -fsS http://127.0.0.1:3000/api/utils/env      # 前端 API
```

---

## 4. Nginx + HTTPS（公网访问）

代理到本机 `3000` 并自动签发证书：

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

创建 `/etc/nginx/sites-available/sub.example.com`：

```nginx
server {
    server_name sub.example.com;
    location / { proxy_pass http://127.0.0.1:3000; }
}
```

启用 + 发证：
```bash
sudo ln -s /etc/nginx/sites-available/sub.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d sub.example.com --redirect
```

> Nginx 反代会把请求转发给后端；后端用 `SUB_STORE_FRONTEND_BACKEND_PATH=/` 同端口服务前端+API，
> 因此 `/api` 与前端都在同一个 3000 端口被反代，无需额外配置。 `CORS` 需要用公网域名。

---

## 5. 升级到新版本

升级不改配置、不改数据目录，只需覆盖运行包并重启。

```bash
export TAG=v0.1.1
export DIR=/opt/sub-store
export RELEASE=https://github.com/ywainzh/Sub-Store/releases/download/${TAG}

# 备份配置（非数据；你的订阅数据在 backend/data）
sudo cp ${DIR}/.env /tmp/.env.bak

# 下载校验解压（同 3.1，覆盖 backend/frontend）
curl -fsSL "${RELEASE}/sub-store-server-${TAG}.tar.gz" -o /tmp/sub-store-server.tar.gz
curl -fsSL "${RELEASE}/checksums.txt" -o /tmp/sub-store-checksums.txt
expected=$(grep "sub-store-server-${TAG}.tar.gz" /tmp/sub-store-checksums.txt | awk '{print $1}')
actual=$(sha256sum /tmp/sub-store-server.tar.gz | awk '{print $1}')
test "${expected}" = "${actual}"
sudo tar -xzf /tmp/sub-store-server.tar.gz -C "${DIR}" --strip-components=1

# 重启服务
sudo systemctl restart sub-store
sudo systemctl status sub-store
curl -fsS http://127.0.0.1:3000/api/utils/env
```

> 升级不会覆盖 `.env` / 数据目录。Sub-Store 的订阅数据保存在 `backend/sub-store.json`
> （由应用运行时生成/读写），注意备份它。

---

## 6. 备份

Sub-Store 的数据文件（含你的订阅、节点配置）：
- `/opt/sub-store/backend/sub-store.json`
- `/opt/sub-store/backend/root.json`（缓存）

手动备份：
```bash
mkdir -p /opt/sub-store/backups
cp /opt/sub-store/backend/sub-store.json /opt/sub-store/backups/sub-store.$(date +%Y%m%d-%H%M%S).json
cp /opt/sub-store/backend/root.json      /opt/sub-store/backups/root.$(date +%Y%m%d-%H%M%S).json
```

可选：cron 每日备份
```bash
sudo install -m 0644 -d /etc/cron.d
# 在 /etc/cron.d/sub-store-backup 中写入：
# 30 3 * * * root cp /opt/sub-store/backend/sub-store.json /opt/sub-store/backups/sub-store.\$(date +%Y%m%d).json
```

---

## 7. 回滚

若新版本异常，回退到上一个版本 tag：

```bash
export DIR=/opt/sub-store
sudo systemctl stop sub-store
curl -fsSL "https://github.com/ywainzh/Sub-Store/releases/download/v0.1.0/sub-store-server-v0.1.0.tar.gz" -o /tmp/rollback.tar.gz
sudo tar -xzf /tmp/rollback.tar.gz -C "${DIR}" --strip-components=1
sudo systemctl start sub-store
curl -fsS http://127.0.0.1:3000/api/utils/env
```

> 数据库无关（Sub-Store 无外部 DB，数据存 JSON），回滚通常不回退数据文件。

---

## 8. 运维 / 排障

```bash
# 状态与日志
sudo systemctl status sub-store
sudo journalctl -u sub-store -n 200 -f

# 进程与资源
ps aux | grep sub-store
df -h / && free -h

# 健康检查
curl -fsS http://127.0.0.1:3000/api/utils/env
```

常见问题：

| 问题 | 排查 |
| --- | --- |
| 服务启动但 3000 无响应 | 看 journalctl；确认端口未被占用、`.env` 正确 |
| 前端打开但 API 报 CORS | `SUB_STORE_CORS_ALLOWED_ORIGINS` 需含你的公网域名 |
| 访问 `/` 返回后端 JSON | 前端静态 `frontend/index.html` 缺失，确认包内 `frontend/` |
| 改了代码不生效 | 确认发布了新 tag 且服务器已拉取新包；CI 在 GitHub 完成 |
| 怀疑包不完整 | 重新校验 `sha256sum` 与 `checksums.txt` |

---

## 9. 与官方上游同步

仓库定期从官方 `sub-store-org/Sub-Store` 同步后端改动到 `release`：

```bash
git switch release
git fetch upstream master
git merge upstream/master
# 解决冲突后
git push origin release
```
> 前端 `frontend-local/` 来自 `sub-store-org/Sub-Store-Front-End`，需单独处理；
> `pnpm install && pnpm build` 后，按发布流程产出版本 tag。

同步完成后打新 tag 发布即可。