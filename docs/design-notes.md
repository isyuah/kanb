# Kanb 设计说明（架构 / 权限 / 工程）

> 系统设计、权限模型与工程取舍的索引。与 `docs/db-design.md`（数据库设计）、`docs/api-contract.md`（接口契约）配套阅读。

## 1. 系统架构

```
浏览器 SPA（React 19 + AntD 6 + zustand）
        │  REST /api（JSON）+ SSE /api/events（实时推送）
        ▼
Go net/http 服务（单二进制，内嵌 webdist 静态资源）
        │
        ▼
Store 层（database/sql + modernc.org/sqlite，纯 Go 免 CGO）
        │
        ▼
SQLite 单文件库（12 表，3NF，PRAGMA foreign_keys=ON）
```

- 前后端分离部署亦可：`web/` 走 Vite dev server 代理 `/api` 到后端。
- SSE hub 推送任务变更，多端实时同步；慢客户端丢消息兜底。
- 连接层 `SetMaxOpenConns(1)` 串行化写（SQLite 文件锁简化），读多写少的看板场景足够。

## 2. 模块划分

| 文件 | 职责 |
|---|---|
| model.go | 领域类型：User/Task/Claim/Progress/Activity/Status 常量（含 Closed 终态判定）/角色常量 |
| store.go | 数据访问：schema、CRUD、关联加载、软删、回收站、防成环 |
| auth.go | 认证与授权：注册/登录/会话/bcrypt、角色、系统设置、种子数据 |
| http.go | HTTP 层：路由、中间件（鉴权/RBAC/公开度）、SSE、CORS、日志 |
| main.go | 启动：flag 解析、静态资源托管、优雅退出 |

## 3. 数据库（12 表，3NF）

完整设计与 3NF 论证见 `docs/db-design.md`。要点：
- 1NF：多值属性拆表——`tags` + `task_tags` 关联表替代 JSON 字符串列。
- 2NF：三张复合主键关联表（task_tags/user_roles/deps）无部分依赖。
- 3NF：无传递依赖；`activities.task_title` 保留为审计快照（刻意的历史事实冗余，报告 §4.4 论证）。
- 参照完整性：外键全部真实启用（`PRAGMA foreign_keys=ON`），级联删除经单测验证无孤儿。
- 业务不变量入库：认领 `UNIQUE(task_id,user_id)`、自依赖 `CHECK(task_id<>dep_id)`、进度 `CHECK(percent 0-100)`。

## 4. RBAC 三角色权限矩阵

| 能力 | viewer（访客） | member（成员） | admin（管理员） |
|---|---|---|---|
| 浏览看板/任务/动态 | ✓ | ✓ | ✓ |
| 创建/编辑任务、认领、报进度、设依赖 | ✗ | ✓ | ✓ |
| 软删任务（回收站） | ✗ | ✓ | ✓ |
| 彻底删除（回收站） | ✗ | 仅自己创建的 | ✓ |
| 用户管理（代建/角色/停用/重置密码） | ✗ | ✗ | ✓ |
| 系统设置（公开度/注册开关） | ✗ | ✗ | ✓ |

- 会话：登录返回随机 token（crypto/rand 64 hex），存 `sessions` 表，30 天过期。
- 密码：bcrypt 哈希存储，绝不明文；改密需验旧密码。
- 保护：不能停用/降级/重置密码自己（改自己密码请走个人中心，需验旧密码）；不能给最后一名 admin 降级（store/handler 层校验）。
- 注册开关（settings 表 `open_registration`，默认开放，见 §5）：关闭后登录页无注册入口、`POST /api/auth/register` 403（空库仍放行，保证首个 admin 引导）；管理员经 `POST /api/users` 代建账号（可设初始密码）成为注册关闭时的唯一加人通道。

## 5. 公开度模式与注册开关（系统设置，settings 表）

| publicMode | 匿名（未登录）访问 |
|---|---|
| private（默认） | 只能看登录/注册页，其余 401 |
| readonly | 可浏览全部数据，写操作 401 |
| open | 完全免登录可读写；匿名写回落内置 `anonymous` 账号（display_name「匿名」） |

- 设计意图：private 适合内部团队（默认）；open 提供免登录即用的轻量入口，适用于公开演示/临时协作；readonly 介于两者之间。
- 匿名回落账号是 `users` 表预置隐藏行，保证 `activities/claims` 的 user_id 外键恒有值。

### 注册开关（open_registration）

- 无记录即开放（老库默认行为不变）；`RegistrationOpen()` 把任何非 `"0"` 值当开放。
- 刻意**不写入 Seed**：Seed 每次启动都会执行且 upsert 覆写（public_mode 因此在每次重启回落默认值），若把注册默认值放进 Seed，管理员关掉的注册会在重启后静默重开——注册开关属于安全边界，不能重蹈覆辙。
- 开关只在 HTTP 层把关（`handleRegister`），store 层 `Register` 不受限：注册/引导单测与 MCP 内建账号逻辑不受开关影响。

## 6. 任务生命周期：回收站 / 归档 / 废弃

- `tasks.deleted_at` 为 NULL 表示未删；软删进回收站，恢复即清标记。
- 彻底删除走物理删除，外键 ON DELETE CASCADE 级联清理 claims/progress/deps/task_tags（activities 无外键，保留审计）。
- 动态在删除前写入 `task_title` 快照，删除后活动页仍能显示标题。

三个「不做/移出看板」机制语义分工：
| 机制 | 语义 | 位置 |
|---|---|---|
| 归档 archived | 暂存、可能回归 | 归档弹窗（任务保留全部状态） |
| 回收站 deleted_at | 误删待恢复/清除 | 回收站页 |
| 废弃 abandoned | 刻意终止、保留记录复盘 | 看板末列（终态，灰色系） |

### 废弃状态（abandoned）与统计口径

- 状态取值 4 个：`todo` / `in_progress` / `done` / `abandoned`。终态判定收敛为 **closed = done ∪ abandoned**（后端 `Status.Closed`、前端 `isClosed`）：终态不计逾期、其下游依赖不再被判定阻塞、不可再选为依赖目标；依赖图终态边静止。
- **统计口径**：全部聚合（taskTotal/状态分布/逾期/平均进度/标签/创建人/成员工作量）只统计活跃任务（未删、未归档、未废弃）；废弃任务由 `/api/stats` 的 `abandoned` 字段单列计数，不进完成率。
- 审计天然兼容：`activities` 的 `{f,t}` 快照为自由字符串，报表页对未知状态码兜底显示原码（`statusLabelRaw`）。
- 前端状态文案/配色/顺序/终态语义收敛于 `web/src/status.ts` 单一注册表（`STATUS_META`/`STATUS_ORDER`/`isClosed`），看板列、日历、依赖图、统计、筛选、状态切换选项全部由它驱动；后端对应 `model.go` 常量 + `http.go validStatus`。新增状态只需同步这两处。
- 存量库升级：SQLite 启动自动重建 tasks 表（见 docs/db-design.md §7）；PG 手动 ALTER。

## 7. 测试

- store 层单测（`server/store_test.go`，go test 全绿）：
  - `TestListUsersNoDeadlock`：回归 ListUsers 在 rows 未关时循环内查角色的自死锁（MaxOpenConns=1）
  - `TestUpdateSelfPassword`：改展示名+改密，新旧密码验证
  - `TestCascadeDelete`：物理删除后子表零孤儿（外键级联护栏）
  - `TestClaimUnique`：认领 UNIQUE 约束
  - `TestWouldCycle`：依赖防成环（含自依赖）
  - `TestSoftDeleteTrash`：软删→回收站→恢复→彻底删除生命周期
  - `TestStatsAbandonedSeparate`：废弃单列计数、不进活跃口径/逾期/ByStatus
  - `TestMigrateTasksStatusCheckRebuild`：旧库启动自动重建、数据保留、幂等
  - `TestAdminCreateUser` / `TestSetUserPassword`：管理员代建（角色/初始密码/重名/保留名）与重置密码（新旧密码验证、内置账号保护）
  - `TestOpenRegistrationSetting`：注册开关默认开放、开关持久化、store 层不受限（HTTP 层把关）
- API 集成冒烟：52 项断言（注册/登录/角色矩阵/公开度三态/回收站/级联/me），与本仓库联调流程同期维护。
- API 契约单测：`TestAbandonedStatusAPI`（废弃 PATCH 生效 + 非法状态 400 + 统计口径）；`TestAdminCreateUserEndpoint` / `TestResetPasswordEndpoint` / `TestRegistrationToggleEndpoint`（代建 201/重名 400、重置后新旧密码、注册开关 403 与恢复、越权 403）。
- 演示数据：`scripts/seed-demo.mjs` 生成一套完整业务场景（三角色用户 + 任务/认领/进度/依赖链），供验收演示与手工验证使用。
- 浏览器端到端：登录门→注册首用户 admin→建任务/认领/进度→日历/回收站/用户管理/系统设置/个人中心逐页人工验证。

## 8. 开发中修复的真实缺陷（报告「测试与排错」素材）

1. **主键冲突**：Windows 时钟粒度下 `newID()`（UnixNano）同毫秒撞主键，多标签任务创建报「多次冲突」。
   修复：纳秒 + 进程内原子序号拼接，全局唯一。
2. **ListUsers 自死锁**：`SetMaxOpenConns(1)` 下，ListUsers 在 `rows` 未关闭时循环内查询用户角色，内层查询等外层连接释放 → 整服僵死（GET /api/users 后所有请求无响应）。
   修复：先全量扫描并关闭 rows，再统一补角色。配套回归单测。

## 9. 技术要点速查

| 维度 | 实现 | 说明 |
|---|---|---|
| 操作者留痕 | users 实体 + user_id 外键 | display_name 变化不影响历史归属 |
| 标签 | tags + task_tags | 1NF 多对多，JOIN 可查 |
| 外键 | PRAGMA foreign_keys=ON | 真实启用 + 级联删除单测覆盖 |
| 权限 | RBAC 三角色 + 会话 | 与公开度模式正交（§4/§5） |
| 删除 | deleted_at 软删 + 回收站 | 防误删、可恢复 |
| 状态体系 | model 常量 + web/src/status.ts 注册表 + Closed 终态 | 文案/配色/列序/逾期/阻塞单源；新增状态只改两处 |
| 存量升级 | SQLite 启动自动重建 tasks 表 | SQLite 无法原地改 CHECK，见 docs/db-design.md §7 |
| 配置 | settings 表（公开度） | 免改代码切公开策略 |
| 前端 | 登录门 + 管理页 + 日历 + 依赖图 | 单页应用全业务覆盖 |
