# Kanb v2 数据库设计（课设）

> 版本：v2（课设二期） · 存储：SQLite（modernc.org/sqlite，纯 Go） · 规范级：3NF

## 1. 需求背景

Kanb 是一套团队任务看板（B/S）。v1 为免登录原型；v2 增加用户体系、角色权限、系统设置（公开度）、回收站（软删）与日历/个人中心等视图，并完成数据库规范化改造。本文档描述 v2 的库表设计与 3NF 论证，是课设数据库部分的规格依据。

## 2. ER 总览

```
users 1───N claims N───1 tasks 1───N progress N───1 users
  │                          │                        │
  └───(created_by)───────────┘                        (user_id)
tasks 1───N task_tags N───1 tags
tasks 1───N deps N───1 tasks          （自引用多对多：task_id → dep_id）
users N───N roles   （user_roles 关联表）
users 1───N sessions
settings（键值配置）
activities（审计流水，user_id 弱引用 + task_title 快照）
```

共 12 张表：

| # | 表 | 角色 |
|---|---|---|
| 1 | users | 用户实体（v2 规范化核心） |
| 2 | roles | 角色字典（admin / member / viewer） |
| 3 | user_roles | 用户—角色 关联 |
| 4 | sessions | 登录会话 |
| 5 | tags | 标签实体（1NF 拆表） |
| 6 | task_tags | 任务—标签 关联 |
| 7 | tasks | 任务（v2：去 JSON 标签列、加 created_by/deleted_at） |
| 8 | claims | 任务认领（多对多：任务—用户） |
| 9 | progress | 进度记录（任务—用户 的 1:N 明细） |
| 10 | deps | 依赖关系（任务自引用多对多） |
| 11 | activities | 操作审计流水 |
| 12 | settings | 系统设置（公开度模式等） |

## 3. 建表 DDL（v2 定稿）

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id            TEXT PRIMARY KEY,              -- 自生成主键（纳秒时间戳）
  username      TEXT NOT NULL UNIQUE,          -- 登录名
  password_hash TEXT NOT NULL,                 -- bcrypt
  display_name  TEXT NOT NULL DEFAULT '',      -- 展示名（原 v1 的操作者名字）
  disabled      INTEGER NOT NULL DEFAULT 0,    -- 停用（软删用户，保审计链）
  created_at    TEXT NOT NULL
);

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,            -- admin | member | viewer
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  position   REAL NOT NULL DEFAULT 0,
  due_date   TEXT,                             -- YYYY-MM-DD
  archived   INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,                             -- 软删标记（回收站）；NULL=未删除
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, -- 创建者（历史数据可空）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_status    ON tasks(status);
CREATE INDEX idx_tasks_archived  ON tasks(archived);
CREATE INDEX idx_tasks_deleted   ON tasks(deleted_at);
CREATE INDEX idx_tasks_createdby ON tasks(created_by);

CREATE TABLE claims (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, user_id)                     -- 一人一任务一次认领（DB 层约束）
);
CREATE INDEX idx_claims_user ON claims(user_id);

CREATE TABLE progress (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  percent    INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  text       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_progress_task ON progress(task_id);
CREATE INDEX idx_progress_user ON progress(user_id);

CREATE TABLE deps (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, dep_id),
  CHECK (task_id <> dep_id)                     -- 禁止自依赖
);

CREATE TABLE activities (
  id         TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  task_title TEXT NOT NULL DEFAULT '',          -- 审计快照（见 3NF 论证 §4.4）
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL, -- NULL=匿名/已注销
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activities_created ON activities(created_at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
```

## 4. 3NF 论证

### 4.1 1NF：属性原子性

- 所有字段均为不可再分的原子值，无重复组、无数组/集合字段。
- **v1 遗留整改点**：v1 的 `tasks.tags` 以 JSON 数组字符串存多值属性，违反 1NF——对标签的查询/统计无法用 SQL 完成，只能整串读出后应用层解析，且无法声明参照完整性。
  v2 拆分为 `tags`（标签实体）与 `task_tags`（关联表），任务-标签成为标准的多对多关系，可用 `JOIN`/`GROUP BY` 直接查询。

### 4.2 2NF：消除部分依赖

2NF 要求：非主属性完全依赖于候选键（对复合主键表不得只依赖其一部分）。

逐表验证复合主键表：

- `task_tags(task_id, tag_id)`：无其他非主属性 → 平凡满足。
- `user_roles(user_id, role_id)`：无其他非主属性 → 平凡满足。
- `deps(task_id, dep_id)`：仅 `created_at`。它描述的是**这条边**的创建时间，同时依赖 `task_id` 与 `dep_id` 两者（两个端点共同确定一条依赖边），不存在只依赖单侧的情况 → 完全依赖，满足。

其余各表均为单主键表，不存在部分依赖。

### 4.3 3NF：消除传递依赖

3NF 要求：非主属性不得传递依赖于主键（即不存在「非主键 → 非主键」的函数依赖）。

逐表验证：

- **users**：非主属性 username/password_hash/display_name/disabled/created_at 两两无函数依赖关系（username 虽 UNIQUE，但它与主键 id 互相唯一——属于候选键，不构成传递依赖），无传递依赖。
- **roles / tags / sessions / settings**：单行实体，属性间无函数依赖。
- **tasks**：status/due_date/archived 等均直接依赖主键 id，互不决定。
- **claims / progress**：user_id、percent/text、created_at 等直接依赖各自主键；不存冗余派生列（如「最新进度」不在 claims 中冗余）。
- **activities**：见 §4.4 快照说明。
- **deps / task_tags / user_roles**：见 §4.2。

### 4.4 activities.task_title：审计快照的刻意冗余（论证）

严格 3NF 视角下，`activities.task_title` 可由 `tasks.title` JOIN 得出，属冗余。但该列记录的是**操作发生时刻**的任务标题，任务可能随后改名甚至被删除（活动记录必须保留——留痕是产品硬需求，故 activities 不设指向 tasks 的外键）。

因此它描述的是历史事实而非当前状态，与「订单保存下单时商品价格快照」同理：时间单向推进、不存在更新异常，删除它反而造成「任务删除后操作历史无法显示标题」的功能缺陷。结论：保留，作为审计快照字段写入报告论证；不是函数依赖违规，而是审计域的语义设计。

### 4.5 参照完整性

- 所有外键均真实声明并在连接层启用：`PRAGMA foreign_keys=ON`（v1 声明了 REFERENCES 却未启用，删除任务会遗留孤儿 claims/progress/deps——v2 修复，并在 store 层测试覆盖级联删除）。
- claims/progress 增加 `UNIQUE(task_id, user_id)` 等数据库层约束，将 v1 靠应用代码维护的不变量下沉到库层。
- 用户采用 disabled 软停用而非物理删除，保证 activities/claims/progress 历史审计链不断（外键均 ON DELETE CASCADE/SET NULL 兜底）。

## 5. 索引与约束小结

见各表 DDL 内。要点：任务列表查询路径（status/archived/deleted_at）、关联反向查询（claims/progress/task_tags 的 user/tag 侧）均建索引；业务不变量（唯一、取值范围、非自环）全部声明为约束。

## 6. 与 v1 的差异对照（报告素材）

| 项 | v1 | v2 | 规范化意义 |
|---|---|---|---|
| 操作者 | 名字字符串散落 3 表 | users 实体 + user_id 外键 | 消除重复存储/更新异常 |
| 任务标签 | tasks.tags JSON 文本 | tags + task_tags | 1NF 拆表 |
| 认领唯一 | 应用层检查 | UNIQUE(task_id,user_id) | 约束入库 |
| 外键 | 声明未启用 | PRAGMA foreign_keys=ON | 参照完整性落地 |
| 删除 | 物理删除 | deleted_at 软删 + 回收站 | 审计/误删恢复 |
| 用户删除 | — | disabled 软停用 | 审计链不断 |
| 系统配置 | 硬编码 | settings 表 | 配置数据化 |
| 自依赖 | 代码防环 | + CHECK(task_id<>dep_id) | 约束入库 |
