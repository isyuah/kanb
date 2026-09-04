# Kanb — 团队任务看板

小团队内部使用的任务看板（BS 架构）。Go 后端 + SQLite 存储 + SSE 实时同步，React + Ant Design 前端。多人可认领同一任务，各自维护进度记录。

## 功能

- 三列看板（待认领 / 进行中 / 已完成），跨列拖拽改状态（拖拽手柄）
- 任务详情抽屉：内容、截止日期、标签、认领人、依赖、进度记录（1:N 可增改删）、操作时间线
- 多人认领同一任务，每人独立的进度百分比 + 说明
- 依赖关系：防成环校验，未完成依赖阻塞提示；依赖总览图（React Flow）
- 用户体系与 RBAC：注册 / 登录，三角色（管理员 / 成员 / 访客），首个注册用户自动为管理员
- 公开度模式（系统设置）：不公开（需登录）/ 公开只读 / 完全公开（免登录可写，回到极简体验）
- 搜索过滤、逾期高亮、归档 / 恢复、回收站（软删可恢复）、日历视图、个人中心
- 团队动态、SSE 多端实时同步；操作自动留痕（谁 + 何时）
- 数据库满足 3NF：用户实体化、任务-标签关联表、外键真实启用、审计快照设计，见 `docs/db-design.md`
- **MCP 支持**：AI 客户端可直接安排任务、认领、报进度、设依赖，见 `docs/mcp.md`
- 接口文档见 `docs/api.md` 与 `docs/api-contract.md`

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

首次启动后打开页面注册第一个账号，即为管理员。

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
- 前端：Vite + React 19 + TypeScript、Ant Design 6、zustand、@dnd-kit（拖拽）、@xyflow/react（依赖图）、dayjs + AntD Calendar（日历视图）、motion（动画）
- 存储：SQLite 单文件；localStorage 缓存登录态与离线展示

## 接口速览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/register · /login · /logout | 注册 / 登录 / 登出 |
| GET | /api/users · POST · PATCH /{id} | 用户管理（admin） |
| GET | /api/settings · PATCH | 系统设置 / 公开度（PATCH 为 admin） |
| GET | /api/tasks | 任务列表（含认领/进度/依赖/标签） |
| POST | /api/tasks | 创建任务 |
| PATCH | /api/tasks/{id} | 更新任务（标题/内容/状态/截止/标签/归档） |
| DELETE | /api/tasks/{id} | 软删任务（进回收站） |
| GET | /api/trash · POST /restore · DELETE | 回收站：列表 / 恢复 / 彻底删除 |
| POST/DELETE | /api/tasks/{id}/claim | 认领 / 取消认领 |
| POST | /api/tasks/{id}/progress | 添加进度记录 |
| PUT/DELETE | /api/progress/{pid} | 修改/删除自己的进度记录 |
| POST/DELETE | /api/tasks/{id}/deps[/{depId}] | 添加/移除依赖（防成环） |
| GET | /api/activities | 操作动态 |
| GET | /api/stats | 看板统计总览（状态/标签/成员工作量/逾期） |
| GET | /api/events | SSE 变更推送 |

鉴权：登录后请求携带 `Authorization: Bearer <token>`（详见 `docs/api-contract.md`）。
