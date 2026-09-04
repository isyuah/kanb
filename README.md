# Kanb — 团队任务看板

小团队内部使用的任务看板（BS 架构）。Go 后端 + SQLite 存储 + SSE 实时同步，React + Ant Design 前端。免登录，仅需输入名字标识操作者；多人可认领同一任务，各自维护进度记录。

## 功能

- 三列看板（待认领 / 进行中 / 已完成），跨列拖拽改状态（拖拽手柄）
- 任务详情抽屉：内容、截止日期、标签、认领人、依赖、进度记录（1:N 可增改删）、操作时间线
- 多人认领同一任务，每人独立的进度百分比 + 说明
- 依赖关系：防成环校验，未完成依赖阻塞提示；依赖总览图（React Flow）
- 搜索过滤、逾期高亮、归档/恢复、团队动态、SSE 多端实时同步
- 操作自动记录「谁 + 何时」，无权限控制，仅留痕
- **MCP 支持**：AI 客户端（Claude Desktop / Codex / Cursor）可直接安排任务、认领、报进度、设依赖，见 `docs/mcp.md`
- 数据格式与接口文档见 `docs/api.md`（供 AI / 外部脚本调用）

## 快速开始（开发）

```bash
# 后端（Go 1.22+，纯 Go SQLite 无需 CGO）
cd server
go run . -addr :8400 -db kanb.db

# 前端（Node 20+）
cd web
npm install
npm run dev        # http://localhost:5173 （代理 /api 到 8400）
```

## 生产部署

```bash
cd web && npm run build        # 产物输出到 server/webdist
cd ../server && go build -o kanb-server.exe .
./kanb-server.exe -addr :8400 -db kanb.db
# 打开 http://localhost:8400 —— 单二进制同时托管前端与 API
```

数据保存在 `kanb.db`（SQLite），备份该文件即可。

## 技术栈

- 后端：Go 标准库 net/http、modernc.org/sqlite（纯 Go）、SSE
- 前端：Vite + React 19 + TypeScript、Ant Design 6、zustand、@dnd-kit（拖拽）、@xyflow/react（依赖图）、motion（动画）
- 存储：SQLite 单文件；localStorage 仅缓存登录名与离线展示

## 接口速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/tasks | 任务列表（含认领/进度/依赖） |
| POST | /api/tasks | 创建任务 |
| PATCH | /api/tasks/{id} | 更新任务（标题/内容/状态/截止/标签/归档） |
| DELETE | /api/tasks/{id} | 删除任务 |
| POST/DELETE | /api/tasks/{id}/claim | 认领 / 取消认领 |
| POST | /api/tasks/{id}/progress | 添加进度记录 |
| PUT/DELETE | /api/progress/{pid} | 修改/删除自己的进度记录 |
| POST/DELETE | /api/tasks/{id}/deps[/{depId}] | 添加/移除依赖（防成环） |
| GET | /api/activities | 操作动态 |
| GET | /api/events | SSE 变更推送 |

请求头 `X-Author: <名字>`（前端自动 URL 编码中文）标识操作者。
