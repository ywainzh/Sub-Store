#!/usr/bin/env bash
# ============================================================
# Sub-Store 生产启动脚本（前后端合并部署，单进程单端口）
#
# 用法:  bash start-prod.sh [端口]
# 默认:  bash start-prod.sh 3000
#
# 依赖:  前端已构建(frontend-local/dist) + 后端已打包(backend/ 含 dist/sub-store.bundle.js)
# 构建:  见 deploy/README.md
# ============================================================

set -euo pipefail

export MSYS2_ARG_CONV_EXCL="*"
export MSYS_NO_PATHCONV="1"

PORT="${1:-3000}"
BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_SRC="$(cd "$(dirname "$0")/frontend-local/dist" && pwd)"

if command -v cygpath >/dev/null 2>&1; then
    FRONTEND_DIST="$(cygpath -w "$FRONTEND_SRC")"
else
    FRONTEND_DIST="$FRONTEND_SRC"
fi

# 生产入口优先用官方自包含 bundle；若无则退回 sub-store.min.js
if [ -f "$BACKEND_DIR/dist/sub-store.bundle.js" ]; then
    RUN_ENTRY="dist/sub-store.bundle.js"
elif [ -f "$BACKEND_DIR/sub-store.min.js" ]; then
    RUN_ENTRY="sub-store.min.js"
else
    echo "[ERROR] 未找到后端可运行文件。请先构建: cd backend && pnpm bundle:esbuild"
    echo "        (产物为 dist/sub-store.bundle.js 或 sub-store.min.js)"
    exit 1
fi
if [ ! -d "$FRONTEND_SRC" ]; then
    echo "[ERROR] 未找到前端构建目录 $FRONTEND_SRC，请先在 frontend-local 目录: pnpm build"
    exit 1
fi

export SUB_STORE_BACKEND_API_PORT="$PORT"
export SUB_STORE_BACKEND_MERGE="ON"
export SUB_STORE_FRONTEND_BACKEND_PATH="/"
export SUB_STORE_FRONTEND_PATH="$FRONTEND_DIST"

# 生产环境：浏览器 CORS 白名单。同源/反代部署时建议设为你的站点来源(逗号分隔)，例如：
#   https://sub.example.com,http://127.0.0.1
# 切勿在公开端口使用 *。未设置时走后端默认(官方 vercel 来源)。
export SUB_STORE_CORS_ALLOWED_ORIGINS="${SUB_STORE_CORS_ALLOWED_ORIGINS:-}"

cd "$BACKEND_DIR"
exec node "$RUN_ENTRY"