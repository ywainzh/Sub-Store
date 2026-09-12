# Sub-Store VPS 部署指南（前后端合并部署）

本文档说明如何把 Sub-Store（后端 + 官方前端）以**单进程、单端口**方式部署到 VPS。
与本地 `start.sh` 完全一致，只是改为生产构建 + 进程守护。

## 目录结构（本仓库现状）

```
Sub-Store/
├── backend/              # Node 后端（sub-store）
├── frontend-local/       # 官方前端 Sub-Store-Front-End（已构建）
│   └── dist/             # 构建产物（index.html + chunks + gzip）
└── start.sh              # 本地开发启动脚本（Merge 模式）
```

## 部署原理

Sub-Store 后端支持 `SUB_STORE_BACKEND_MERGE=ON` 合并模式：
后端进程在同一端口同时托管**前端静态文件**和 **`/api` 后端接口**，只需一个进程。

前端构建时设 `VITE_API_URL='/'`（同源），所有 `/api/...` 请求自动打到当前端口。

---

## 一、在 VPS 上部署（Ubuntu/Debian）

### 1. 安装依赖

```bash
# Node.js 20+（建议安装 .node-version 要求的 24.15.0，推荐用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 24.15.0
nvm use 24.15.0

# pnpm
npm i -g pnpm
```

### 2. 上传代码到 VPS

可选方式：Git、rsync、scp。以 scp 为例：

```bash
scp -r Sub-Store root@你的IP:/opt/sub-store
```

### 3. 生产构建（前端 + 后端）

```bash
cd /opt/sub-store/frontend-local
pnpm i --no-frozen-lockfile
pnpm build          # 生成 dist/（VITE_API_URL='/' 已同源配置）

cd /opt/sub-store/backend
pnpm i --no-frozen-lockfile
pnpm bundle:esbuild # 生成 sub-store.min.js（生产压缩产物）
```

> 生产建议用 `bundle:esbuild` 生成压缩版 `sub-store.min.js`，体积小、启动快。

### 4. 生产启动脚本 `start-prod.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
PORT="${1:-3000}"
BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_DIST="$(cd "$(dirname "$0")/frontend-local/dist" && pwd)"

export SUB_STORE_BACKEND_API_PORT="$PORT"
export SUB_STORE_BACKEND_MERGE="ON"
export SUB_STORE_FRONTEND_BACKEND_PATH="/"
export SUB_STORE_FRONTEND_PATH="$FRONTEND_DIST"

cd "$BACKEND_DIR"
exec node sub-store.min.js
```

### 5. 用 pm2 守护进程（推荐）

```bash
npm i -g pm2
chmod +x start-prod.sh
pm2 start /opt/sub-store/start-prod.sh --name sub-store
pm2 save                    # 保存进程列表
pm2 startup                 # 开机自启（按提示执行输出命令）
```

验证：
```bash
curl -s http://127.0.0.1:8080        # 应返回前端 HTML
curl -s http://127.0.0.1:8080/api/utils/env | head   # 应返回 {"status":"success",...}
```

---

## 二、（可选）反代 + HTTPS + 域名

如果你有域名并想用 HTTPS 访问，用 Caddy（自动申请证书，最简单）：

```bash
apt install -y caddy
```

创建 `/etc/caddy/Caddyfile`：

```
sub.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
systemctl reload caddy
```

访问 `https://sub.example.com` 即得完整界面。

> 反向代理模式下后端无需配置，合并前端 + 后端的 `:8080` 一起被代理即可。

---

## 三、务必修改默认访问保护（安全）

单纯的默认部署**没有访问鉴权**，任何人访问你的 VPS 端口都能查看/修改你的订阅。
建议至少不要暴露公网端口，用防火墙限制来源，或通过反代加 Basic Auth：

```bash
# Caddy 加简单密码（可选）
sub.example.com {
    basic_auth {
        admin $2y$...   # htpasswd 生成的 hash
    }
    reverse_proxy 127.0.0.1:8080
}
```

或限制来源 IP。**不要**把 3000/8080 直接暴露到 `0.0.0.0`。

---

## 四、常见问题

| 问题 | 原因 / 解决 |
|------|------------|
| 访问 `/` 返回 `{"status":"success",guide...}` | SUB_STORE_FRONTEND_PATH 未指向 dist 或构建文件缺失 |
| 前端打开了但接口报错 | 确认 `VITE_API_URL` 构建时为 `'/'`，且与后端同端口 |
| 新端口不生效 | 清浏览器缓存/hard reload（PWA 缓存） |
| gzip 不生效 | 后端 `frontend-static` 中间件自动处理 `.gz` |
| 浏览器报 `403 CORS origin not allowed` | `SUB_STORE_CORS_ALLOWED_ORIGINS` 未包含你的站点来源。本地开发设 `*`，生产设为你的 https 域名（逗号分隔） |