# Kanb v2 API 契约（课设二期）

> 后端实现与前端调用共同遵守。改动需主代理确认。

## 认证

- `POST /api/auth/register` body `{ username, password, displayName? }` → `201 { token, user }`
  - 首个注册用户自动为 admin，其余默认 member。
  - username 唯一；password 长度 ≥ 6（后端校验，错误 400）。
- `POST /api/auth/login` body `{ username, password }` → `200 { token, user }`
- `POST /api/auth/logout` header `Authorization: Bearer <token>` → `204`（删会话）
- user 结构：`{ id, username, displayName, role, disabled, createdAt }`
- 登录后请求带 `Authorization: Bearer <token>`。

## 公开度（匿名访问）

- `GET /api/settings` → `200 { publicMode }`，publicMode ∈ `private | readonly | open`（默认 private）
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
- 用户创建走 `POST /api/auth/register`（默认 member；首个注册为 admin）
- `PUT /api/users/{id}/role` body `{ role }`（admin，改角色）
- `PUT /api/users/{id}/disabled` body `{ disabled }`（admin，停用/启用）
  - 不允许停用/改自己；不允许给最后一名 admin 降级/停用（后端校验）。

## 任务

- `GET /api/tasks?includeArchived=1` → `Task[]`，不含软删（回收站）项
- `POST /api/tasks` body `TaskInput` → `201 Task`
- `PATCH /api/tasks/{id}` body `TaskPatch` → `200 Task`
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

## 认领 / 进度 / 依赖（与 v1 同路径）

- `POST|DELETE /api/tasks/{id}/claim`
- `POST /api/tasks/{id}/progress` body `{ percent, text }`
- `PUT|DELETE /api/progress/{pid}`（仅本人，403 兜底）
- `POST /api/tasks/{id}/deps` body `{ depId }`；`DELETE /api/tasks/{id}/deps/{depId}`
- `PUT /api/tasks/reorder` body `{ status, ids }`（同 v1）

## 动态

- `GET /api/activities?limit=n` → Activity：
  ```
  { id, action, target, targetId, taskTitle, userId, authorName, createdAt }
  ```
  authorName = displayName；用户已注销/匿名 → null

## 系统设置（admin）

- `GET /api/settings` → `{ publicMode, auth }`（公开，登录页据此决定显示登录门）
- `PUT /api/settings/public-mode` body `{ publicMode }` → `200 { publicMode }`（admin）

## 错误

统一 `{ error: string }`。SSE `GET /api/events` 不变。
