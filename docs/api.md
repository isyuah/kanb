# Kanb API 数据格式文档

供 AI 客户端 / 外部脚本通过 HTTP 操作看板。基地址 `http://<host>:8400/api`。

## 通用约定

- **认证**：无登录。每个写请求带请求头 `X-Author: <操作者名字>`，服务端据此记录「谁做的」。名字含中文/非 ASCII 时必须 **URL 编码**（浏览器 fetch 无法直接放非 Latin-1 字符到 header）：
  ```
  X-Author: %E9%99%88%E9%BB%98      # = 陈默
  ```
  缺该头 → `400 {"error":"缺少 X-Author 请求头"}`。
- **Content-Type**: `application/json`。
- **ID**：服务端生成（Unix 纳秒时间戳字符串）。
- **时间**：`createdAt` / `updatedAt` 为 ISO8601 UTC（`2026-09-02T13:03:28Z`）。`dueDate` 为 `YYYY-MM-DD` 或 `null`。
- **状态枚举** `status`：`todo`（待认领）| `in_progress`（进行中）| `done`（已完成）。
- **错误**：非 2xx 返回 `{"error": "中文可读信息"}`。
- **SSE 实时推送**：`GET /api/events`（EventSource）。任何变更后推送 `data: {"type":"changed","taskId":"<id>"}`，另有心跳注释行。客户端应在其后重新拉取数据。

## 数据模型

### Task（任务，列表项含全部内嵌关系）

```json
{
  "id": "1788356477669229500",
  "title": "实现后端 API",
  "content": "REST 接口 + 依赖环校验 + SSE 推送",
  "status": "in_progress",
  "dueDate": "2026-09-05",
  "tags": ["后端"],
  "archived": false,
  "createdAt": "2026-09-02T13:03:28Z",
  "updatedAt": "2026-09-02T14:10:00Z",
  "deps": [
    {
      "taskId": "1788356477669229500",
      "depId": "1788356477000000001",
      "title": "设计数据库 Schema",
      "status": "done",
      "archived": false
    }
  ],
  "claims": [
    { "id": "1788356500000000001", "taskId": "1788356477669229500", "claimer": "陈默", "createdAt": "2026-09-02T13:10:00Z" }
  ],
  "progress": [
    { "id": "1788356600000000001", "taskId": "1788356477669229500", "author": "陈默", "percent": 60, "text": "路由与 handler 完成", "createdAt": "2026-09-02T13:20:00Z", "updatedAt": "2026-09-02T13:20:00Z" }
  ]
}
```

语义要点：
- `deps[]` 是**该任务的前置依赖**（本任务等它完成）：`depId` 指向被依赖任务。
- 认领可多人；每人有独立 `progress` 记录流（1 认领者 : N 条记录）。
- 任务级进度展示 = 所有进度记录 `percent` 的平均（前端计算），无独立字段。

### 其他类型

```jsonc
// Claim
{ "id": "…", "taskId": "…", "claimer": "陈默", "createdAt": "…" }

// ProgressEntry
{ "id": "…", "taskId": "…", "author": "陈默", "percent": 60, "text": "…", "createdAt": "…", "updatedAt": "…" }

// Activity（操作动态）
{ "id": "…", "action": "claimed", "target": "task", "targetId": "…", "taskTitle": "实现后端 API", "author": "陈默", "createdAt": "…" }
```

`action` 取值：`created` `updated` `deleted` `archived` `unarchived` `claimed` `unclaimed` `progress` `progress_updated` `progress_deleted` `dep_added` `dep_removed`。

## 接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tasks?includeArchived=true` | 任务全列表（默认不含已归档） |
| POST | `/tasks` | 创建任务 |
| PATCH | `/tasks/{id}` | 部分更新任务 |
| DELETE | `/tasks/{id}` | 删除任务（级联删认领/进度/依赖） |
| POST | `/tasks/{id}/claim` | 认领任务 |
| DELETE | `/tasks/{id}/claim` | 取消认领 |
| POST | `/tasks/{id}/progress` | 添加进度记录 |
| PUT | `/progress/{pid}` | 修改进度记录（仅作者本人，403） |
| DELETE | `/progress/{pid}` | 删除进度记录（仅作者本人，403） |
| POST | `/tasks/{id}/deps` | 添加依赖（服务端防成环，409） |
| DELETE | `/tasks/{id}/deps/{depId}` | 移除依赖 |
| GET | `/activities?limit=100` | 操作动态（新→旧，默认 100，上限 500） |
| GET | `/events` | SSE 变更推送 |

### POST /tasks — 创建

请求：
```json
{ "title": "实现登录页", "content": "表单 + 校验", "status": "todo", "dueDate": "2026-09-10", "tags": ["前端"] }
```
`title` 必填非空；其余可省略（默认 `todo`/空）。响应 `201` + 完整 Task（含空关系数组）。

### PATCH /tasks/{id} — 部分更新

请求只放要改的字段：
```json
{ "status": "in_progress" }
{ "title": "新标题", "dueDate": null }        // dueDate 传 null 清除截止日
{ "archived": true }                          // 归档；false 恢复
{ "tags": ["前端", "P1"], "content": "…" }
```
响应 `200` + 更新后的完整 Task。**不要整体 PUT**——该接口只支持 PATCH。

### 认领 / 取消认领

```
POST   /tasks/{id}/claim        → 204
DELETE /tasks/{id}/claim        → 204
```
重复认领 → `409 {"error":"你已经认领过该任务"}`。

### 进度记录

添加（作者 = `X-Author`）：
```json
POST /tasks/{id}/progress
{ "percent": 60, "text": "路由完成" }
```
`percent` 0–100；`text` 可空串。响应 `201` + ProgressEntry。

修改（**只能改自己创建的**，他人记录 → `403`）：
```json
PUT /progress/{pid}
{ "percent": 80, "text": "联调完成" }
```

删除：`DELETE /progress/{pid}`（同样仅作者本人）。

### 依赖

```
POST   /tasks/{id}/deps     body: { "depId": "<被依赖任务 id>" }   → 204
DELETE /tasks/{id}/deps/{depId}                                    → 204
```
- `{id}` 依赖 `{depId}`，即 `{id}` 完成后才做 `{depId}`…… 语义：**`{id}` 要等 `{depId}` 完成**。
- 自依赖 / 会成环 → `409 {"error":"添加该依赖会形成循环"}`。AI 安排任务链时按依赖序创建即可（先建被依赖任务，后建依赖者），天然无环。

## AI 安排任务示例（curl）

```bash
BASE=http://localhost:8400/api
ME=%E9%99%88%E9%BB%98   # 陈默

# 1) 建被依赖任务
A=$(curl -s -X POST $BASE/tasks -H "Content-Type: application/json" -H "X-Author: $ME" \
  -d '{"title":"设计评审","tags":["设计"]}' | jq -r .id)

# 2) 建依赖它的任务
B=$(curl -s -X POST $BASE/tasks -H "Content-Type: application/json" -H "X-Author: $ME" \
  -d '{"title":"按评审实现","tags":["后端"],"dueDate":"2026-09-12"}' | jq -r .id)

# 3) 加依赖 B 等 A
curl -s -X POST $BASE/tasks/$B/deps -H "Content-Type: application/json" -H "X-Author: $ME" -d "{\"depId\":\"$A\"}"

# 4) 认领 + 报进度
curl -s -X POST $BASE/tasks/$B/claim -H "X-Author: $ME"
curl -s -X POST $BASE/tasks/$B/progress -H "Content-Type: application/json" -H "X-Author: $ME" \
  -d '{"percent":20,"text":"开始实现"}'
```

## 注意事项（给 AI 客户端）

1. **X-Author 必须 URL 编码中文名**；若用英文名可免编码。
2. 列表接口返回完整嵌套（含 claims/progress/deps），数据量大时注意；当前小团队规模无分页。
3. 写入后服务端推 SSE；UI 会自行刷新，无需额外通知。
4. 无删除任务之外的「清空全部」接口——AI 批量清理需逐个 DELETE（建议先 GET 列表取 id）。
5. 认领、进度、依赖、活动均记录 `author`，AI 代操作时用哪个名字即显示为谁，请与用户确认身份策略。
