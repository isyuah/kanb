# Kanb API 契约

> 后端实现与前端调用共同遵守的接口约定。

## 认证

- `POST /api/auth/register` body `{ username, password, displayName? }` → `201 { token, user }`
  - 首个注册用户自动为 admin，其余默认 member。
  - username 唯一；password 长度 ≥ 6（后端校验，错误 400）。
  - 系统设置关闭自助注册（registration=false）且库中已有用户时 → `403 { error: "注册已关闭…" }`（库空时仍放行，保证部署引导）。
- `POST /api/auth/login` body `{ username, password }` → `200 { token, user }`
- `POST /api/auth/logout` header `Authorization: Bearer <token>` → `204`（删会话）
- user 结构：`{ id, username, displayName, role, disabled, createdAt }`
- 登录后请求带 `Authorization: Bearer <token>`。

## 公开度（匿名访问）

- `GET /api/settings` → `200 { publicMode, registration }`，publicMode ∈ `private | readonly | open`（默认 private）；registration 为是否开放自助注册（登录页据此决定显示注册入口）
- 匿名（无 token）：
  - private：除 `/api/auth/register|login`、`GET /api/settings` 外一律 `401`
  - readonly：可 `GET`（tasks/activities/…），写操作 `401`
  - open：可读写；匿名写操作回落内置 anonymous 账号（viewer 角色）
- 登录用户不受公开度限制，按 RBAC。

## RBAC

| 能力 | viewer | member | admin |
|---|---|---|---|
| GET 数据 | ✓ | ✓ | ✓ |
| 业务写（建任务/编辑自己创建的/认领/进度/依赖/归档/软删） | ✗ | ✓ | ✓ |
| 用户管理、系统设置、彻底删除任务 | ✗ | ✗ | ✓ |

越权返回 `403 { error }`。

## 用户管理（admin，后端实际实现）

- `GET /api/users` → `[{ id, username, displayName, role, disabled, createdAt }]`
- `GET /api/me` → 当前登录 user；`PUT /api/me` body `{ displayName?, password? }` → `200 user`（个人中心改自己）
- `POST /api/users` body `{ username, password, displayName?, role? }`（admin，代建账号）→ `201 user`
  - 注册关闭时的加人通道；role 缺省 member，可指定 admin/member/viewer；password 长度 ≥ 6；不返回 token。
- `PUT /api/users/{id}/password` body `{ password }`（admin，重置密码）→ `204`
  - 自定义新密码直接生效（无需旧密码）；不允许重置自己（请走个人中心）；password 长度 ≥ 6。
- `PUT /api/users/{id}/role` body `{ role }`（admin，改角色）
- `PUT /api/users/{id}/disabled` body `{ disabled }`（admin，停用/启用）
  - 不允许停用/改自己；不允许给最后一名 admin 降级/停用（后端校验）。

## 任务

- `GET /api/tasks?includeArchived=1` → `Task[]`，不含软删（回收站）项
- `POST /api/tasks` body `TaskInput` → `201 Task`
- `PATCH /api/tasks/{id}` body `TaskPatch` → `200 Task`
- `status` 取值枚举：`todo` | `in_progress` | `done` | `abandoned`（废弃=刻意终止的终态；未知取值 400）
- `DELETE /api/tasks/{id}` → `204`（软删：置 deleted_at，进回收站；member 仅限自己创建的，admin 可删任意——403 兜底）
- Task JSON 兼容扩展：
  ```
  {
    id, title, content, status, position, dueDate, tags: string[],
    archived, deletedAt: string|null, createdAt, updatedAt,
    createdBy: string|null, createdByName: string|null,
    deps: Dep[], claims: Claim[], progress: ProgressEntry[]
  }
  ```
- Claim：`{ id, taskId, userId, claimer, createdAt }`（claimer=displayName 展示名，兼容旧字段）
- ProgressEntry：`{ id, taskId, userId, author, percent, text, createdAt, updatedAt }`
- Dep 不变 + title/status/archived（join tasks）

## 回收站（软删）

- `GET /api/trash` → `Task[]`（deleted_at 非空，含关系）
- `POST /api/trash/{id}/restore` → `200 Task`（清 deleted_at）
- `DELETE /api/trash/{id}` → `204`（彻底物理删除 + 级联；admin 或创建者）

## 认领 / 进度 / 依赖

- `POST|DELETE /api/tasks/{id}/claim`
- `POST /api/tasks/{id}/progress` body `{ percent, text }`
- `PUT|DELETE /api/progress/{pid}`（仅本人，403 兜底）
- `POST /api/tasks/{id}/deps` body `{ depId }`；`DELETE /api/tasks/{id}/deps/{depId}`
- `PUT /api/tasks/reorder` body `{ status, ids }`

## 动态

- `GET /api/activities?limit=n` → Activity：
  ```
  { id, action, target, targetId, taskTitle, userId, authorName, createdAt }
  ```
  authorName = displayName；用户已注销/匿名 → null

## 统计（看板总览）

- `GET /api/stats` → Stats（只读，经 gateRead 放行）：
  ```
  {
    taskTotal, todo, inProgress, done, abandoned, overdue, archived, avgTaskPct,
    byStatus:  [{ status, count }],
    byTag:     [{ tag, count }],
    byCreator: [{ userId?, userName?, count }],
    byMember:  [{ userId?, userName, taskCount, avgPct }]
  }
  ```
  - 活跃口径（taskTotal/各计数/byStatus/byTag/byCreator/byMember/avgTaskPct）= 未删除、未归档且未废弃的任务；逾期 = 活跃未完成且 dueDate < 今日。
  - `abandoned`：废弃任务数（未删未归档），单列计数、不进完成率；`byStatus` 不含 abandoned 行。
  - avgTaskPct：所有进度记录 percent 的平均（0-100）。
  - byMember：仅统计认领过任务的用户，avgPct 为该用户全部进度记录均值。

## 系统设置（admin）

- `GET /api/settings` → `{ publicMode, registration, auth }`（公开，登录页据此决定显示登录门/注册入口）
- `PUT /api/settings/public-mode` body `{ publicMode }` → `200 { publicMode }`（admin）
- `PUT /api/settings/registration` body `{ registration: bool }` → `200 { registration }`（admin）
  - 关闭后 `POST /api/auth/register` 403（库空引导场景除外）；管理员 `POST /api/users` 代建不受影响。

## AI 使用指南（公开）

- `GET /api/guide` → `text/markdown`（内嵌 `server/guide.md`，无鉴权）。供 MCP 的
  `get_usage_guide` 工具与 `kanb://guide` 资源拉取；内容为 AI 操作约定，
  与 `docs/mcp.md` 同步维护。

## 错误

统一 `{ error: string }`。SSE `GET /api/events` 不变。
