// Kanb MCP server: exposes kanban operations to MCP clients (Claude Desktop,
// Codex, Cursor, etc). Each tool maps 1:1 to the kanb REST API and requires
// an `author` argument (name recorded as the operator).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

var (
	kanbBase = "http://localhost:8400/api"
	httpCli  = &http.Client{Timeout: 30 * time.Second}
)

func main() {
	base := flag.String("base", "", "kanb REST base URL, default http://localhost:8400/api")
	flag.Parse()
	if *base != "" {
		kanbBase = strings.TrimSuffix(*base, "/")
	}

	s := server.NewMCPServer("kanb", "0.1.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithLogging(),
	)

	registerTools(s)

	if err := server.ServeStdio(s); err != nil {
		log.Fatalf("mcp serve: %v", err)
	}
	_ = os.Stdout
}

// ---- kanb REST helpers ----

func kanbReq(ctx context.Context, method, path string, author string, body any) (int, []byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, kanbBase+path, rdr)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if author != "" {
		req.Header.Set("X-Author", url.QueryEscape(author)) // 中文名需编码
	}
	resp, err := httpCli.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, err
	}
	return resp.StatusCode, data, nil
}

// toolResult builds a text/JSON result with proper error mapping.
func toolResult(err error, data []byte) *mcp.CallToolResult {
	if err != nil {
		return mcp.NewToolResultError("调用 kanb API 失败: " + err.Error())
	}
	return mcp.NewToolResultText(string(data))
}

func withAuthor(author string, next func(author string) (*mcp.CallToolResult, error)) (result *mcp.CallToolResult, err error) {
	a := strings.TrimSpace(author)
	if a == "" {
		return mcp.NewToolResultError("缺少 author 参数：请提供操作者名字（将记录为操作人）"), nil
	}
	return next(a)
}

// ---- tool definitions ----

func registerTools(s *server.MCPServer) {
	// helper: text tool requiring author
	authorTool := func(name, desc string, args map[string]mcp.ToolOption, handler func(author string, arguments map[string]any) (*mcp.CallToolResult, error)) {
		opts := map[string]mcp.ToolOption{
			"author": mcp.WithDescription("操作者名字（必填，将被记录为该操作的执行人）"),
		}
		for k, v := range args {
			opts[k] = v
		}
		t := mcp.NewTool(name, append([]mcp.ToolOption{mcp.WithDescription(desc)}, collectOptions(opts)...)...)
		s.AddTool(t, func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			args, ok := req.Params.Arguments.(map[string]any)
			if !ok {
				return mcp.NewToolResultError("参数格式错误"), nil
			}
			author, _ := args["author"].(string)
			return withAuthor(author, func(a string) (*mcp.CallToolResult, error) {
				return handler(a, args)
			})
		})
	}

	// ---- read-only tools ----

	s.AddTool(
		mcp.NewTool("list_tasks",
			mcp.WithDescription("列出全部任务（含认领人、进度记录、依赖）。archived=true 时包含已归档任务。"),
			mcp.WithBoolean("archived", mcp.Description("是否包含已归档任务，默认 false")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			q := ""
			if archived, _ := argsOf(req, "archived").(bool); archived {
				q = "?includeArchived=true"
			}
			code, data, err := kanbReq(ctx, "GET", "/tasks"+q, "", nil)
			if err != nil {
				return toolResult(err, nil), nil
			}
			if code != 200 {
				return toolResult(fmt.Errorf("HTTP %d: %s", code, data), nil), nil
			}
			return mcp.NewToolResultText(string(data)), nil
		},
	)

	s.AddTool(
		mcp.NewTool("get_task",
			mcp.WithDescription("获取单个任务完整详情（含依赖/认领/进度/时间线相关）。"),
			mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			id, _ := argsOf(req, "task_id").(string)
			if id == "" {
				return mcp.NewToolResultError("task_id 必填"), nil
			}
			code, data, err := kanbReq(ctx, "GET", "/tasks/"+url.PathEscape(id), "", nil)
			if err != nil {
				return toolResult(err, nil), nil
			}
			if code != 200 {
				return toolResult(fmt.Errorf("HTTP %d: %s", code, data), nil), nil
			}
			return mcp.NewToolResultText(string(data)), nil
		},
	)

	s.AddTool(
		mcp.NewTool("list_activities",
			mcp.WithDescription("查看最近操作动态（谁在何时做了什么）。"),
			mcp.WithNumber("limit", mcp.Description("条数，默认 50")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			lim, _ := argsOf(req, "limit").(float64)
			if lim <= 0 {
				lim = 50
			}
			code, data, err := kanbReq(ctx, "GET", fmt.Sprintf("/activities?limit=%d", int(lim)), "", nil)
			if err != nil {
				return toolResult(err, nil), nil
			}
			if code != 200 {
				return toolResult(fmt.Errorf("HTTP %d: %s", code, data), nil), nil
			}
			return mcp.NewToolResultText(string(data)), nil
		},
	)

	// ---- write tools ----

	authorTool("create_task", "创建任务。建议先列出现有任务避免重复。",
		map[string]mcp.ToolOption{
			"title":    mcp.WithString("title", mcp.Required(), mcp.Description("任务标题（必填）")),
			"content":  mcp.WithString("content", mcp.Description("任务详细内容/背景")),
			"status":   mcp.WithString("status", mcp.Description("todo | in_progress | done，默认 todo")),
			"due_date": mcp.WithString("due_date", mcp.Description("截止日期 YYYY-MM-DD，可省略")),
			"tags":     mcp.WithArray("tags", mcp.Description("标签数组，如 [\"前端\",\"P1\"]")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			title, _ := args["title"].(string)
			if strings.TrimSpace(title) == "" {
				return mcp.NewToolResultError("title 不能为空"), nil
			}
			body := map[string]any{
				"title":   title,
				"content": strOr(args["content"], ""),
				"status":  strOr(args["status"], "todo"),
				"dueDate": nilIfEmpty(strOr(args["due_date"], "")),
			}
			if tags, ok := args["tags"].([]any); ok {
				arr := make([]string, 0, len(tags))
				for _, t := range tags {
					if s, ok := t.(string); ok {
						arr = append(arr, s)
					}
				}
				body["tags"] = arr
			}
			code, data, err := kanbReq(context.Background(), "POST", "/tasks", author, body)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("update_task", "部分更新任务（标题/内容/状态/截止日/标签/归档）。只传要改的字段。",
		map[string]mcp.ToolOption{
			"task_id":  mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
			"title":    mcp.WithString("title", mcp.Description("新标题")),
			"content":  mcp.WithString("content", mcp.Description("新内容")),
			"status":   mcp.WithString("status", mcp.Description("todo | in_progress | done")),
			"due_date": mcp.WithString("due_date", mcp.Description("YYYY-MM-DD；传空字符串清除")),
			"archived": mcp.WithBoolean("archived", mcp.Description("归档 true / 恢复 false")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			if id == "" {
				return mcp.NewToolResultError("task_id 必填"), nil
			}
			body := map[string]any{}
			if v, ok := args["title"].(string); ok && v != "" {
				body["title"] = v
			}
			if v, ok := args["content"].(string); ok {
				body["content"] = v
			}
			if v, ok := args["status"].(string); ok && v != "" {
				body["status"] = v
			}
			if v, ok := args["due_date"].(string); ok {
				if v == "" {
					body["dueDate"] = nil
				} else {
					body["dueDate"] = v
				}
			}
			if v, ok := args["archived"].(bool); ok {
				body["archived"] = v
			}
			if len(body) == 0 {
				return mcp.NewToolResultError("没有可更新的字段"), nil
			}
			code, data, err := kanbReq(context.Background(), "PATCH", "/tasks/"+url.PathEscape(id), author, body)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("delete_task", "永久删除任务（连同认领/进度/依赖记录）。",
		map[string]mcp.ToolOption{
			"task_id": mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			if id == "" {
				return mcp.NewToolResultError("task_id 必填"), nil
			}
			code, data, err := kanbReq(context.Background(), "DELETE", "/tasks/"+url.PathEscape(id), author, nil)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("claim_task", "认领任务（作者成为认领人之一；可多人认领同一任务）。",
		map[string]mcp.ToolOption{
			"task_id": mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			if id == "" {
				return mcp.NewToolResultError("task_id 必填"), nil
			}
			code, data, err := kanbReq(context.Background(), "POST", "/tasks/"+url.PathEscape(id)+"/claim", author, nil)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("unclaim_task", "取消认领任务（作者本人）。",
		map[string]mcp.ToolOption{
			"task_id": mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			if id == "" {
				return mcp.NewToolResultError("task_id 必填"), nil
			}
			code, data, err := kanbReq(context.Background(), "DELETE", "/tasks/"+url.PathEscape(id)+"/claim", author, nil)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("add_progress", "为任务添加一条进度记录（可多人各自记录）。",
		map[string]mcp.ToolOption{
			"task_id": mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
			"percent": mcp.WithNumber("percent", mcp.Required(), mcp.Description("完成百分比 0-100")),
			"text":    mcp.WithString("text", mcp.Description("进度说明")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			pct, _ := args["percent"].(float64)
			if id == "" || pct < 0 || pct > 100 {
				return mcp.NewToolResultError("task_id 必填且 percent 需在 0-100"), nil
			}
			body := map[string]any{"percent": int(pct), "text": strOr(args["text"], "")}
			code, data, err := kanbReq(context.Background(), "POST", "/tasks/"+url.PathEscape(id)+"/progress", author, body)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("add_dependency", "为任务添加前置依赖：本任务需等待 dep_id 指向的任务完成。服务端防成环。",
		map[string]mcp.ToolOption{
			"task_id": mcp.WithString("task_id", mcp.Required(), mcp.Description("依赖方任务 ID")),
			"dep_id":  mcp.WithString("dep_id", mcp.Required(), mcp.Description("被依赖任务 ID（先完成它）")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			dep, _ := args["dep_id"].(string)
			if id == "" || dep == "" {
				return mcp.NewToolResultError("task_id 与 dep_id 均必填"), nil
			}
			code, data, err := kanbReq(context.Background(), "POST", "/tasks/"+url.PathEscape(id)+"/deps", author, map[string]any{"depId": dep})
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("remove_dependency", "移除任务的前置依赖。",
		map[string]mcp.ToolOption{
			"task_id": mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
			"dep_id":  mcp.WithString("dep_id", mcp.Required(), mcp.Description("被依赖任务 ID")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			dep, _ := args["dep_id"].(string)
			if id == "" || dep == "" {
				return mcp.NewToolResultError("task_id 与 dep_id 均必填"), nil
			}
			code, data, err := kanbReq(context.Background(), "DELETE", "/tasks/"+url.PathEscape(id)+"/deps/"+url.PathEscape(dep), author, nil)
			_ = code
			return toolResult(err, data), nil
		},
	)

	// ---- 评论 ----

	s.AddTool(
		mcp.NewTool("list_comments",
			mcp.WithDescription("查看某任务的评论（含回复，按时间正序）。"),
			mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
		),
		func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			id, _ := argsOf(req, "task_id").(string)
			if id == "" {
				return mcp.NewToolResultError("task_id 必填"), nil
			}
			code, data, err := kanbReq(ctx, "GET", "/tasks/"+url.PathEscape(id)+"/comments", "", nil)
			if err != nil {
				return toolResult(err, nil), nil
			}
			if code != 200 {
				return toolResult(fmt.Errorf("HTTP %d: %s", code, data), nil), nil
			}
			return mcp.NewToolResultText(string(data)), nil
		},
	)

	authorTool("add_comment", "为任务发表评论（或回复某条评论）。",
		map[string]mcp.ToolOption{
			"task_id":   mcp.WithString("task_id", mcp.Required(), mcp.Description("任务 ID")),
			"content":   mcp.WithString("content", mcp.Required(), mcp.Description("评论内容（1-2000 字符，支持 Markdown）")),
			"parent_id": mcp.WithString("parent_id", mcp.Description("回复的评论 ID；不填为顶层评论")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			id, _ := args["task_id"].(string)
			content, _ := args["content"].(string)
			parent, _ := args["parent_id"].(string)
			content = strings.TrimSpace(content)
			if id == "" || content == "" {
				return mcp.NewToolResultError("task_id 与 content 均必填"), nil
			}
			if len(content) > 2000 {
				return mcp.NewToolResultError("content 需在 1-2000 字符内"), nil
			}
			body := map[string]any{"content": content, "parentId": nilIfEmpty(parent)}
			code, data, err := kanbReq(context.Background(), "POST", "/tasks/"+url.PathEscape(id)+"/comments", author, body)
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("edit_comment", "编辑自己的评论内容。",
		map[string]mcp.ToolOption{
			"comment_id": mcp.WithString("comment_id", mcp.Required(), mcp.Description("评论 ID")),
			"content":    mcp.WithString("content", mcp.Required(), mcp.Description("新的评论内容（1-2000 字符）")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			cid, _ := args["comment_id"].(string)
			content, _ := args["content"].(string)
			content = strings.TrimSpace(content)
			if cid == "" || content == "" {
				return mcp.NewToolResultError("comment_id 与 content 均必填"), nil
			}
			if len(content) > 2000 {
				return mcp.NewToolResultError("content 需在 1-2000 字符内"), nil
			}
			code, data, err := kanbReq(context.Background(), "PATCH", "/comments/"+url.PathEscape(cid), author, map[string]any{"content": content})
			_ = code
			return toolResult(err, data), nil
		},
	)

	authorTool("delete_comment", "删除自己的评论（作者本人或管理员）。删除顶层评论会连带删除其全部回复。",
		map[string]mcp.ToolOption{
			"comment_id": mcp.WithString("comment_id", mcp.Required(), mcp.Description("评论 ID")),
		},
		func(author string, args map[string]any) (*mcp.CallToolResult, error) {
			cid, _ := args["comment_id"].(string)
			if cid == "" {
				return mcp.NewToolResultError("comment_id 必填"), nil
			}
			code, data, err := kanbReq(context.Background(), "DELETE", "/comments/"+url.PathEscape(cid), author, nil)
			_ = code
			return toolResult(err, data), nil
		},
	)
}

func argsOf(req mcp.CallToolRequest, key string) any {
	args, ok := req.Params.Arguments.(map[string]any)
	if !ok {
		return nil
	}
	return args[key]
}

func collectOptions(m map[string]mcp.ToolOption) []mcp.ToolOption {
	out := make([]mcp.ToolOption, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

func strOr(v any, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
