package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// ---- 报表（report）插件点 ----
//
// 核心只提供「事件查询」原语，具体报表（半周报等）以独立文件注册到 registry。
// 每个报表 = 一个 ReportDef：定义元信息 + Run 函数（返回结构化 JSON，前端渲染）。
// 前端渲染层（表格/Markdown/图片）一律放前端，后端只出结构化数据。

// ReportResult 报表统一返回体（JSON 直接透传给前端）。
type ReportResult struct {
	// Meta 由框架填充
	ReportID  string `json:"reportId"`
	Title     string `json:"title"`
	From      string `json:"from"` // ISO8601（已按 UTC 存）
	To        string `json:"to"`
	GeneratedAt string `json:"generatedAt"`
	// Events 事件明细（按时间正序）
	Events []ReportEvent `json:"events"`
	// Summary 报表自定义汇总（nil 则前端省略）
	Summary any `json:"summary,omitempty"`
}

// ReportEvent 单条可汇报事件（结构化，前端据此渲染表格/文本）。
type ReportEvent struct {
	At        string `json:"at"` // ISO8601 UTC
	UserID    string `json:"userId,omitempty"`
	UserName  string `json:"userName"` // display name（已注销→"已注销"）
	Action    string `json:"action"`
	TaskID    string `json:"taskId"`
	TaskTitle string `json:"taskTitle"`
	// Detail 原始 JSON（可为空），前端按 action 解析展示；也保留富字段。
	Detail json.RawMessage `json:"detail,omitempty"`
}

// parseReportWindow 解析 ?from= &to= 参数（ISO8601 / RFC3339，允许 'Z' 或带时区偏移）。
// 返回规范化 UTC RFC3339 字符串。缺省 from=最近7天前、to=now（宽松）。
func parseReportWindow(r *http.Request) (from, to string, err error) {
	q := r.URL.Query()
	now := time.Now().UTC().Truncate(time.Second)
	toS := q.Get("to")
	fromS := q.Get("from")
	to = now.Format(time.RFC3339)
	if toS != "" {
		t, e := time.Parse(time.RFC3339, toS)
		if e != nil {
			// 容忍无时区的本地时间（按服务器本地时区解释）
			t, e = time.ParseInLocation("2006-01-02 15:04:05", toS, time.Local)
		}
		if e != nil {
			return "", "", e
		}
		to = t.UTC().Format(time.RFC3339)
	}
	if fromS != "" {
		t, e := time.Parse(time.RFC3339, fromS)
		if e != nil {
			t, e = time.ParseInLocation("2006-01-02 15:04:05", fromS, time.Local)
		}
		if e != nil {
			return "", "", e
		}
		from = t.UTC().Format(time.RFC3339)
	} else {
		from = now.AddDate(0, 0, -7).Format(time.RFC3339)
	}
	if from >= to {
		return "", "", errBadWindow
	}
	return from, to, nil
}

var errBadWindow = &httpError{code: 400, msg: "时间窗口无效: from 必须早于 to"}

// httpError 轻量 HTTP 错误（handler 内使用）。
type httpError struct {
	code int
	msg  string
}

func (e *httpError) Error() string { return e.msg }

// parseMemberIDs 解析 ?members=u1,u2（逗号分隔 user_id；空 = 全部）。
func parseMemberIDs(r *http.Request) []string {
	raw := r.URL.Query().Get("members")
	if raw == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// handleSemiweeklyReport 半周报：统计 [from,to) 内所有可汇报事件。
// 返回结构化事件流；前端按成员分组、类型筛选、渲染表格/Markdown/图片。
func (a *app) handleSemiweeklyReport(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseReportWindow(r)
	if err != nil {
		he, ok := err.(*httpError)
		if ok {
			a.writeErr(w, he.code, he.msg)
		} else {
			a.writeErr(w, 400, "时间参数格式无效（需 ISO8601/RFC3339）")
		}
		return
	}
	memberIDs := parseMemberIDs(r)
	acts, err := a.store.ReportEvents(from, to, memberIDs)
	if err != nil {
		a.writeErr(w, 500, "读取报表数据失败: "+err.Error())
		return
	}
	events := make([]ReportEvent, 0, len(acts))
	for _, act := range acts {
		ev := ReportEvent{
			At:        act.CreatedAt,
			UserID:    act.UserID,
			UserName:  act.AuthorName,
			Action:    act.Action,
			TaskID:    act.TargetID,
			TaskTitle: act.TaskTitle,
		}
		if act.Detail != "" {
			ev.Detail = json.RawMessage(act.Detail)
		}
		events = append(events, ev)
	}
	res := ReportResult{
		ReportID:    "semiweekly",
		Title:       "半周报",
		From:        from,
		To:          to,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Events:      events,
	}
	a.writeJSON(w, 200, res)
}

// registerReportRoutes 挂报表路由（/api/reports/semiweekly）。
// 目前只一个报表；后续扩展只需往这里加 HandleFunc。
func (a *app) registerReportRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/reports/semiweekly", a.gateRead(a.handleSemiweeklyReport))
}
