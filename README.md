# Kanb — 团队任务看板

![CI](https://github.com/isyuah/kanb/actions/workflows/ci.yml/badge.svg)
![Go](https://img.shields.io/badge/Go-1.27-blue)
![React](https://img.shields.io/badge/React-19-61dafb)

Kanb 是一个面向小团队的轻量任务看板：**Go 单二进制后端 + React 前端**，开箱即用、数据落在一个 SQLite 文件里，还带 SSE 实时同步与 MCP 接口，AI 也能直接上手帮你干活。

## 功能一览

- **看板**：待认领 / 进行中 / 已完成三列，拖拽改状态；搜索、筛选、逾期高亮
- **任务详情**：内容（Markdown 编辑预览）、认领人、依赖关系（防成环）、进度记录、操作时间线、**讨论评论**（支持回复/编辑/删除）
- **协作**：多人认领同一任务、各自独立进度；团队动态流、SSE 多端实时同步
- **权限**：注册/登录 + RBAC 三角色（管理员/成员/访客）；站点可设为私有 / 公开只读 / 完全公开
- **管理**：回收站（软删可恢复）、归档、日历视图、统计总览、个人中心
- **AI 接入**：内置 MCP server，Claude / Codex / Cursor 等客户端可直接安排任务、报进度、发评论
- **多数据库**：本地 SQLite 零配置；设 `KANB_DATABASE_URL` 即切云端 PostgreSQL（Render/Supabase/Neon），见 `docs/multi-db.md`

## 快速开始

### 开发模式（前后端分离）

```bash
# 后端（Go 1.27+；纯 Go SQLite，无需 CGO）
cd server
go run . -addr :8400 -db kanb.db

# 前端（Node 20+）
cd web
npm install
npm run dev        # http://localhost:5173（代理 /api 到 8400）
```

打开页面注册第一个账号即为管理员。

### 单二进制部署

```bash
cd web && npm run build          # 产物输出到 server/webdist
cd ../server && go build -o kanb-server.exe .
./kanb-server.exe -addr :8400 -db kanb.db
# 打开 http://localhost:8400 —— 一个进程同时托管前端与 API
```

数据全部在 `kanb.db`（SQLite 单文件），备份它即完成备份。

### Docker

两条路：

**① 本地构建（多阶段：前端 → Go 交叉编译 → 精简镜像，无需本地装 Go/Node）**

```bash
docker compose -f deploy/docker-compose.yml up --build
# 打开 http://localhost:8400；数据持久化在 deploy/data/kanb.db
```

**② 直接跑 CI 构建好的镜像（GitHub Actions 推送至 GHCR，build once / deploy many）**

```bash
docker pull ghcr.io/isyuah/kanb:latest
docker run -d -p 127.0.0.1:8400:8400 -v ./data:/data ghcr.io/isyuah/kanb:latest
```

每次 push main 自动构建 `ghcr.io/isyuah/kanb:<sha>` 与 `:latest`；打 `v*` tag 另推版本镜像（见 `.github/workflows/docker.yml`）。

## 让 AI 干活（MCP）

MCP server（`mcp/`）把看板操作暴露给 AI 客户端：列/建任务、认领、报进度、设依赖、看/发/回/删评论。

```bash
cd mcp && go build -o kanb-mcp.exe .
```

以真实账号身份运行（推荐——操作归属真人、任意公开度可写）：

```json
// Claude Desktop: claude_desktop_config.json
{
  "mcpServers": {
    "kanb": {
      "command": "E:\\Proj\\kanb\\mcp\\kanb-mcp.exe",
      "env": { "KANB_USERNAME": "ai-bot", "KANB_PASSWORD": "******" }
    }
  }
}
```

- 不配凭据则匿名运行（仅看板 open 模式可写，操作显示为「匿名」）
- 也可用 `KANB_TOKEN` 环境变量或 `-token` 参数注入已有会话
- token 过期会自动用账号密码重新登录并重放请求，无需人工干预
- 完整说明见 [`docs/mcp.md`](docs/mcp.md)

## 技术栈

后端 Go（net/http + SQLite/PostgreSQL + SSE）· 前端 React 19 / TypeScript / Ant Design 6 / Vite · 存储 SQLite 单文件或云端 PostgreSQL · CI GitHub Actions

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/db-design.md`](docs/db-design.md) | 数据库设计：12 表 schema、3NF 论证、约束与索引 |
| [`docs/design-notes.md`](docs/design-notes.md) | 架构 / RBAC 权限矩阵 / 公开度 / 设计取舍与踩坑记录 |
| [`docs/api.md`](docs/api.md) · [`docs/api-contract.md`](docs/api-contract.md) | REST 接口说明与请求/响应契约 |
| [`docs/multi-db.md`](docs/multi-db.md) | 多数据库支持：SQLite / PostgreSQL 选择、方言适配与测试 |
| [`docs/mcp.md`](docs/mcp.md) | MCP server 工具清单与客户端配置 |
