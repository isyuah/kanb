# Kanb MCP Server — 让 AI 直接安排任务

MCP（Model Context Protocol）server 把看板操作暴露给 AI 客户端（Claude Desktop、Codex、Cursor、其他 MCP 客户端）。AI 可以列任务、建任务、认领、报进度、设依赖，全程以你指定的名字留痕。

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

## 工具清单

| 工具 | 说明 | 关键参数 |
|---|---|---|
| `list_tasks` | 列出全部任务（含认领/进度/依赖） | `archived?` |
| `get_task` | 单个任务完整详情 | `task_id` |
| `list_activities` | 最近操作动态 | `limit?` |
| `create_task` | 创建任务 | `author*` `title*` `content?` `status?` `due_date?` `tags?` |
| `update_task` | 部分更新（标题/内容/状态/截止/归档） | `author*` `task_id*` |
| `delete_task` | 永久删除任务 | `author*` `task_id*` |
| `claim_task` | 认领任务（可多人） | `author*` `task_id*` |
| `unclaim_task` | 取消认领 | `author*` `task_id*` |
| `add_progress` | 添加进度记录 | `author*` `task_id*` `percent*`(0-100) `text?` |
| `add_dependency` | 加前置依赖（防成环） | `author*` `task_id*` `dep_id*` |
| `remove_dependency` | 移除依赖 | `author*` `task_id*` `dep_id*` |

`*` = 必填。`author` 是操作者名字——**它会作为该操作人显示在看板动态里**，AI 替谁干活就填谁（或填一个统一的 `AI助手` 名字，团队成员可辨识）。

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

> 帮我把「设计评审」拆成 3 个任务并创建，加上依赖关系：先做 A 再做 B 最后 C；然后认领 A 并报 20% 进度。操作人写「AI助手」。

AI 会依次调用 `list_tasks`（查重）→ `create_task` → `add_dependency` → `claim_task` → `add_progress`。所有变更实时出现在看板 UI（SSE 推送）。

## 开发备注

- transport：stdio（标准 MCP）；协议版本 2024-11-05。
- 实现：Go + `github.com/mark3labs/mcp-go`，每个工具转发到 kanb REST API（见 `docs/api.md` 数据格式）。
- 中文 author 经 URL 编码传输，与看板前端行为一致。
