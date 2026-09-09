# Kanb MCP Server — 让 AI 直接安排任务

MCP（Model Context Protocol）server 把看板操作暴露给 AI 客户端（Claude Desktop、Codex、Cursor、其他 MCP 客户端）。AI 可以列任务、建任务、认领、报进度、设依赖、发评论。**所有写操作都以 MCP 进程配置的账号身份留痕**（见下方「身份认证」）：动态/认领/进度/评论归属该账号；无凭据时回落匿名（open 公开模式下显示为「匿名」）。工具调用不需要也不接受 author 参数。

## 快速开始

1. 先启动看板服务（默认 `http://localhost:8400`）：
   ```bash
   cd server && go run . -addr :8400 -db kanb.db
   ```
2. 构建 MCP server：
   ```bash
   cd mcp && go build -o kanb-mcp.exe .
   ```
3. 在客户端配置中注册（见下）。`-base` 可指向其他地址/端口。

## 身份认证

MCP 默认匿名运行（写操作需看板为 open 公开模式）。要让操作**以真实用户身份留痕**（任意公开度均可写、审计归属真人、评论编辑/删除权限正确），配置以下凭据之一：

| 方式 | 配置 | 说明 |
|---|---|---|
| 账号密码（推荐） | 环境变量 `KANB_USERNAME` + `KANB_PASSWORD` | 启动时自动登录换 token（存内存不落盘）；**token 失效（过期/被撤销）时自动重新登录并重放请求，最多一次** |
| 会话 token | 环境变量 `KANB_TOKEN` 或启动参数 `-token <token>` | 直接使用已有会话（可从看板登录响应或浏览器 localStorage `kanb.token` 获取）；失效后若同时配了账号密码会自动续期，否则需手动更换 |

优先级：`-token` > `KANB_TOKEN` > `KANB_USERNAME`/`KANB_PASSWORD`。无任何凭据时回落匿名模式。

> 安全建议：给 AI 配**专用低权账号**（member 即可，勿用 admin）；撤销访问 = 在用户管理停用该账号（无需改 MCP 配置）。密码明文存在于进程环境——与看板同机部署的可信场景下可接受；跨机部署请改用 `-token` 且不要配账号密码。

## 工具清单

| 工具 | 说明 | 关键参数 |
|---|---|---|
| `get_usage_guide` | 获取看板使用指南（状态/字段约定、流程示例、错误含义）；不确定操作约定时先调用 | — |
| `list_tasks` | 列出全部任务（含认领/进度/依赖） | `archived?` |
| `get_task` | 单个任务完整详情 | `task_id` |
| `list_activities` | 最近操作动态 | `limit?` |
| `create_task` | 创建任务 | `title*` `content?` `status?` `due_date?` `tags?` |
| `update_task` | 部分更新（标题/内容/状态/截止/归档） | `task_id*` |
| `delete_task` | 永久删除任务 | `task_id*` |
| `claim_task` | 认领任务（可多人） | `task_id*` |
| `unclaim_task` | 取消认领 | `task_id*` |
| `add_progress` | 添加进度记录 | `task_id*` `percent*`(0-100) `text?` |
| `add_dependency` | 加前置依赖（防成环） | `task_id*` `dep_id*` |
| `remove_dependency` | 移除依赖 | `task_id*` `dep_id*` |
| `list_comments` | 查看某任务评论（含回复） | `task_id*` |
| `add_comment` | 发表评论/回复 | `task_id*` `content*` `parent_id?` |
| `edit_comment` | 编辑自己的评论 | `comment_id*` `content*` |
| `delete_comment` | 删除评论（删顶层连带回复） | `comment_id*` |

`*` = 必填。`status` 取值：`todo` / `in_progress` / `done` / `abandoned`。写操作显示的操作人 = 配置的看板账号（KANB_USERNAME 或 token 对应用户，见「身份认证」）；想区分多个 AI 的操作，请为每个 AI 配置独立账号。

**使用指南双通道（同源）**：指南内嵌在服务端（`server/guide.md`，经 `GET /api/guide` 提供），AI 可通过 `get_usage_guide` 工具**主动拉取**，或以 MCP 资源 `kanb://guide` **附加进对话**（支持资源浏览/附加的客户端，如 Claude Desktop）。二者内容一致——若指南全文已出现在当前对话（如已附加该资源），无需再调用工具；工具描述内含此引导。指南与本文档约定同步维护，改任一处需同步另一处。

## 客户端配置

### Claude Desktop

`claude_desktop_config.json`（设置 → Developer → Edit Config）：
```json
{
  "mcpServers": {
    "kanb": {
      "command": "E:\\Proj\\kanb\\mcp\\kanb-mcp.exe",
      "args": []
    }
  }
}
```

### Codex CLI

`~/.codex/config.toml`：
```toml
[mcp_servers.kanb]
command = "E:/Proj/kanb/mcp/kanb-mcp.exe"
```

### Cursor

Settings → MCP → Add new MCP server：
```json
{
  "mcpServers": {
    "kanb": {
      "command": "E:/Proj/kanb/mcp/kanb-mcp.exe",
      "args": []
    }
  }
}
```

### 任意 MCP 客户端（stdio）

`command: kanb-mcp.exe`，无额外参数。若看板不在本机 8400，加 `-base http://<host>:<port>/api`。

## 让 AI 安排任务的建议话术

> 帮我把「设计评审」拆成 3 个任务并创建，加上依赖关系：先做 A 再做 B 最后 C；然后认领 A 并报 20% 进度。

AI 会依次调用 `list_tasks`（查重）→ `create_task` → `add_dependency` → `claim_task` → `add_progress`。所有变更实时出现在看板 UI（SSE 推送），操作人显示为 MCP 配置的看板账号。

## 开发备注

- transport：stdio（标准 MCP）；协议版本 2024-11-05。
- 实现：Go + `github.com/mark3labs/mcp-go`，每个工具转发到 kanb REST API（见 `docs/api-contract.md` 数据格式）。
- 三平台二进制由 GitHub Actions 在打 `v*` 标签时构建并发布（`.github/workflows/release.yml`）。
