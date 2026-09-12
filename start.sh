#!/usr/bin/env bash
# ============================================================
# Sub-Store 本地启动脚本（前后端合并部署，单进程单端口）
#
# 使用方法:
#   基础启动:   bash start.sh
#   指定端口:   bash start.sh 8080
#
# 说明:
#   - 前端默认为 frontend-local/dist (官方前端构建产物)
#   - SUB_STORE_BACKEND_MERGE=ON  前后端同端口合并部署
#   - SUB_STORE_FRONTEND_BACKEND_PATH=/  后端 API 挂载在根路径
#   - 前端构建时 VITE_API_URL='/'，请求自动打到同源当前端口
# ============================================================

set -euo pipefail

# Windows Git Bash / MSYS: 禁用路径自动转换，避免把 SUB_STORE_FRONTEND_BACKEND_PATH="/" 转成 "C:/Program Files/Git/"
export MSYS2_ARG_CONV_EXCL="*"
export MSYS_NO_PATHCONV="1"

# ---- 参数 ----
PORT="${1:-3000}"
BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"
FRONTEND_SRC="$(cd "$(dirname "$0")/frontend-local/dist" && pwd)"

# Windows/mingw: 转为 Windows 绝对路径(否则 Node 无法解析 /c/ 形式的 MSYS 路径)
if command -v cygpath >/dev/null 2>&1; then
    FRONTEND_DIST="$(cygpath -w "$FRONTEND_SRC")"
else
    FRONTEND_DIST="$FRONTEND_SRC"
fi

if [ ! -d "$FRONTEND_SRC" ]; then
    echo "[ERROR] 未找到前端构建目录: $FRONTEND_SRC"
    echo "请先在 frontend-local 目录执行: pnpm install && pnpm build"
    exit 1
fi

echo "=============================================="
echo "  Sub-Store 本地开发环境 (Merge 模式)"
echo "  端口:     $PORT"
echo "  后端目录: $BACKEND_DIR"
echo "  前端目录: $FRONTEND_DIST"
echo "  访问地址: http://127.0.0.1:$PORT"
echo "=============================================="

cd "$BACKEND_DIR"

# ---- 合并部署环境变量 ----
export SUB_STORE_BACKEND_API_PORT="$PORT"
export SUB_STORE_BACKEND_MERGE="ON"
export SUB_STORE_FRONTEND_BACKEND_PATH="/"
export SUB_STORE_FRONTEND_PATH="$FRONTEND_DIST"

# 浏览器 CORS 白名单。本地开发放开 * 允许从 http://127.0.0.1:3000 等来源访问接口。
# 生产环境切记改为具体来源(逗号分隔)，且勿在公开端口用 *。可用环境变量覆盖：
export SUB_STORE_CORS_ALLOWED_ORIGINS="${SUB_STORE_CORS_ALLOWED_ORIGINS:-*}"

# 开发模式（带 src 热重载）。生产部署用 pnpm bundle:esbuild + node sub-store.min.js
exec node esbuild-dev.js