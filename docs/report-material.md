# Kanb v2 课设报告素材（架构 / 权限 / 工程）

> 供课设报告「系统设计」「系统实现」「测试」章节取材。本文件是素材索引，正文需按课程模板展开。

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
| model.go | 领域类型：User/Task/Claim/Progress/Activity/Status/角色常量 |
| store.go | 数据访问：schema、CRUD、关联加载、软删、回收站、防成环 |
| auth.go | 认证与授权：注册/登录/会话/bcrypt、角色、系统设置、种子数据 |
| http.go | HTTP 层：路由、中间件（鉴权/RBAC/公开度）、SSE、CORS、日志 |
| main.go | 启动：flag 解析、静态资源托管、优雅退出 |

## 3. 数据库（12 表，3NF）

完整设计与 3NF 论证见 `docs/db-design.md`。要点：
- 1NF 整改：v1 `tasks.tags` JSON 多值属性 → `tags` + `task_tags` 关联表。
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
| 用户管理（角色/停用） | ✗ | ✗ | ✓ |
| 系统设置（公开度） | ✗ | ✗ | ✓ |

- 会话：登录返回随机 token（crypto/rand 64 hex），存 `sessions` 表，30 天过期。
- 密码：bcrypt 哈希存储，绝不明文；改密需验旧密码。
- 保护：不能停用/降级自己、不能给最后一名 admin 降级（store 层校验）。

## 5. 公开度模式（系统设置，settings 表）

| publicMode | 匿名（未登录）访问 |
|---|---|
| private（默认） | 只能看登录/注册页，其余 401 |
| readonly | 可浏览全部数据，写操作 401 |
| open | 完全免登录可读写；匿名写回落内置 `anonymous` 账号（display_name「匿名」） |

- 设计意图：private 适合内部团队；open 复刻 v1「免登录极简体验」，二者兼得。
- 匿名回落账号是 `users` 表预置隐藏行，保证 `activities/claims` 的 user_id 外键恒有值。

## 6. 软删与回收站

- `tasks.deleted_at` 为 NULL 表示未删；软删进回收站，恢复即清标记。
- 彻底删除走物理删除，外键 ON DELETE CASCADE 级联清理 claims/progress/deps/task_tags（activities 无外键，保留审计）。
- 动态在删除前写入 `task_title` 快照，删除后活动页仍能显示标题。

## 7. 测试

- store 层单测（`server/store_test.go`，6 例，go test 全绿）：
  - `TestListUsersNoDeadlock`：回归 ListUsers 在 rows 未关时循环内查角色的自死锁（MaxOpenConns=1）
  - `TestUpdateSelfPassword`：改展示名+改密，新旧密码验证
  - `TestCascadeDelete`：物理删除后子表零孤儿（外键级联护栏）
  - `TestClaimUnique`：认领 UNIQUE 约束
  - `TestWouldCycle`：依赖防成环（含自依赖）
  - `TestSoftDeleteTrash`：软删→回收站→恢复→彻底删除生命周期
- API 集成冒烟：52 项断言全绿（注册/登录/角色矩阵/公开度三态/回收站/级联/me），脚本已归档 docs/seed-demo.mjs 同期的 smoke 流程。
- 浏览器端到端：登录门→注册首用户 admin→建任务/认领/进度→日历/回收站/用户管理/系统设置/个人中心逐页人工验证。

## 8. 开发中修复的真实缺陷（报告「测试与排错」素材）

1. **主键冲突**：Windows 时钟粒度下 `newID()`（UnixNano）同毫秒撞主键，多标签任务创建报「多次冲突」。
   修复：纳秒 + 进程内原子序号拼接，全局唯一。
2. **ListUsers 自死锁**：`SetMaxOpenConns(1)` 下，ListUsers 在 `rows` 未关闭时循环内查询用户角色，内层查询等外层连接释放 → 整服僵死（GET /api/users 后所有请求无响应）。
   修复：先全量扫描并关闭 rows，再统一补角色。配套回归单测。

## 9. 演进对照（v1 → v2，报告「课程设计内容」章节）

| 维度 | v1（原型） | v2（课设） |
|---|---|---|
| 操作者 | 名字字符串散落 3 表 | users 实体 + user_id 外键（3NF） |
| 标签 | tasks.tags JSON | tags + task_tags（1NF） |
| 外键 | 声明未启用 | PRAGMA 启用 + 级联 + 单测 |
| 权限 | 无（仅留痕） | RBAC 三角色 + 会话 |
| 删除 | 物理删除 | 软删 + 回收站 |
| 配置 | 硬编码 | settings 表（公开度） |
| 前端 | 输入名字即用 | 登录门 + 用户体系 + 管理页 + 日历 |
