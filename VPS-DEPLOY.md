# VPS 部署（快速索引）

> ⚠️ **完整部署手册请参见 [`deploy/README.md`](deploy/README.md)**。
>
> 本文档（早期版本）此前的"服务器上编译/构建"方式已废弃；
> 现在统一为 **GitHub Actions 构建发布包 + 服务器仅下载解压运行**的"不编译"方案。

## 部署目标（以 `deploy/README.md` 为准)

| 项 | 值 |
| --- | --- |
| 发布分支 | `release` |
| 发布包 | GitHub Release: `sub-store-server-<tag>.tar.gz` |
| 部署目录 | `/opt/sub-store` |
| 应用端口 | `3000`（可改） |
| 运行入口 | `backend/dist/sub-store.bundle.js`（自包含，无需 node_modules） |
| 进程守护 | systemd（推荐）/ pm2 |

## 快速上手（完整步骤见 deploy/README.md）

```bash
# 1) 在本仓库 release 分支打 tag（让 CI 构建发布包）
git switch release && git push origin release
git tag -a v0.1.0 -m "Sub-Store v0.1.0" && git push origin v0.1.0

# 2) 在服务器上只下载解压 + systemd 运行（不编译）
curl -fsSL https://github.com/ywainzh/Sub-Store/releases/download/v0.1.0/sub-store-server-v0.1.0.tar.gz -o /tmp/ss.tgz
sudo tar -xzf /tmp/ss.tgz -C /opt/sub-store --strip-components=1
# 配置 /opt/sub-store/.env（port/merge/CORS），写 systemd unit（见 deploy/README.md §3）
sudo systemctl enable --now sub-store
```

详见 [`deploy/README.md`](deploy/README.md) 的完整章节：
发布流程、首次部署、Nginx+HTTPS、升级、备份、回滚、排障、上游同步。