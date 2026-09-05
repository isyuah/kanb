package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ---- SSE hub ----

type hub struct {
	mu   sync.Mutex
	subs map[chan string]bool
}

func newHub() *hub { return &hub{subs: map[chan string]bool{}} }

func (h *hub) add() chan string {
	ch := make(chan string, 16)
	h.mu.Lock()
	h.subs[ch] = true
	h.mu.Unlock()
	return ch
}

func (h *hub) remove(ch chan string) {
	h.mu.Lock()
	if h.subs[ch] {
		delete(h.subs, ch)
		close(ch)
	}
	h.mu.Unlock()
}

func (h *hub) publish(taskID string) {
	payload := fmt.Sprintf(`{"type":"changed","taskId":%s}`, jsonString(taskID))
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- payload:
		default: // slow client; drop
		}
	}
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// ---- shared app state ----

type app struct {
	store *Store
	hub   *hub
}

// ---- 鉴权与上下文 ----

type ctxKey int

const (
	ckUser ctxKey = iota // *User（已登录用户，未登录时不存在）
)

func withUser(r *http.Request, u *User) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ckUser, u))
}

// currentUser 从请求上下文取当前登录用户；nil 表示匿名。
func currentUser(r *http.Request) *User {
	u, _ := r.Context().Value(ckUser).(*User)
	return u
}

// bearerToken 解析 Authorization: Bearer <token>。
func bearerToken(r *http.Request) string {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[len("Bearer "):])
	}
	return ""
}

// tryAuth 若请求带合法 Bearer token，则把解析出的用户放入上下文（幂等：已有则跳过）。
func (a *app) tryAuth(r *http.Request) (*http.Request, error) {
	if currentUser(r) != nil {
		return r, nil
	}
	tok := bearerToken(r)
	if tok == "" {
		return r, nil
	}
	u, err := a.store.UserByToken(tok)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return r, nil // 无效/过期 token：等同匿名
	}
	return withUser(r, u), nil
}

// requireUser 中间件：无有效会话（或会话过期/停用）→ 401。
func (a *app) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, err := a.tryAuth(r)
		if err != nil {
			a.writeErr(w, 500, "校验会话失败")
			return
		}
		if currentUser(rr) == nil {
			a.writeErr(w, 401, "未登录或登录已过期")
			return
		}
		next(w, rr)
	}
}

// requireRole 中间件：要求已登录且角色 ≥ minRole（admin/member/viewer 递增）。
func (a *app) requireRole(minRole string, next http.HandlerFunc) http.HandlerFunc {
	return a.requireUser(func(w http.ResponseWriter, r *http.Request) {
		if roleRank[currentUser(r).Role] < roleRank[minRole] {
			a.writeErr(w, 403, "没有权限执行该操作")
			return
		}
		next(w, r)
	})
}

// gateWrite 中间件：放行已登录 member/admin（viewer 只读被拒）或 open 模式匿名；
// private/readonly 的匿名写 → 401，viewer 写 → 403。
func (a *app) gateWrite(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, err := a.tryAuth(r)
		if err != nil {
			a.writeErr(w, 500, "校验会话失败")
			return
		}
		if u := currentUser(rr); u != nil {
			if u.Role == RoleViewer {
				a.writeErr(w, 403, "访客角色只读，不能执行写操作")
				return
			}
			next(w, rr)
			return
		}
		mode, err := a.store.PublicMode()
		if err != nil {
			a.writeErr(w, 500, "读取公开度失败")
			return
		}
		if mode != ModeOpen {
			a.writeErr(w, 401, "未登录或当前公开度不允许该操作")
			return
		}
		next(w, a.asAnon(rr))
	}
}

// gateRead 中间件：放行已登录，或 readonly/open 模式的匿名 GET；private 匿名 → 401。
func (a *app) gateRead(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, err := a.tryAuth(r)
		if err != nil {
			a.writeErr(w, 500, "读取公开度失败")
			return
		}
		if currentUser(rr) != nil {
			next(w, rr)
			return
		}
		mode, err := a.store.PublicMode()
		if err != nil {
			a.writeErr(w, 500, "读取公开度失败")
			return
		}
		if mode == ModePrivate {
			a.writeErr(w, 401, "未登录或看板未公开")
			return
		}
		next(w, rr) // readonly/open 匿名 GET 放行，无需回落身份
	}
}

// asAnon 把匿名请求的身份回落为内置 anonymous 用户（open 模式写操作）。
func (a *app) asAnon(r *http.Request) *http.Request {
	return withUser(r, &User{ID: a.anonymousID(), Username: AnonUsername, DisplayName: "匿名", Role: RoleViewer})
}

// anonymousID 返回内置 anonymous 用户 id（open 模式匿名写回落的固定身份）。
// 用 Store 方法查询并缓存，避免 http 层直触 db。
func (a *app) anonymousID() string {
	id, _ := a.store.AnonymousID()
	return id
}

// writeAuthor 操作者信息：UserID 与展示名（兼容 activities 记录）。
func writeAuthor(r *http.Request) (userID, displayName string) {
	if u := currentUser(r); u != nil {
		return u.ID, u.DisplayName
	}
	return "", ""
}

// recordActivity 记录动态：author 现取 user_id（display_name 冗余在 JOIN 时取）。
func (a *app) recordActivity(r *http.Request, action, target, targetID string) {
	userID, _ := writeAuthor(r)
	if userID == "" {
		return // 匿名且非 open 模式等边缘情况：不记录
	}
	title := a.store.TaskTitle(targetID)
	act := Activity{
		ID:        newID(),
		Action:    action,
		Target:    target,
		TargetID:  targetID,
		TaskTitle: title,
		UserID:    userID,
		CreatedAt: now(),
	}
	if err := a.store.AddActivity(act); err != nil {
		log.Warn().Err(err).Str("action", action).Str("target", target).Str("targetId", targetID).Msg("record activity")
	}
	a.hub.publish(targetID)
}

// ---- JSON 工具 ----

func (a *app) writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Warn().Err(err).Msg("write json")
	}
}

func (a *app) writeErr(w http.ResponseWriter, code int, msg string) {
	a.writeJSON(w, code, map[string]string{"error": msg})
}

func (a *app) writeNoContent(w http.ResponseWriter) { w.WriteHeader(204) }

func validStatus(s Status) bool {
	return s == StatusTodo || s == StatusInProgress || s == StatusDone
}

// currentUserID 返回操作者 user_id（已登录或回落 anonymous；空 = 不应发生）。
func (a *app) currentUserID(r *http.Request) string {
	if u := currentUser(r); u != nil {
		if u.ID != "" {
			return u.ID
		}
	}
	return ""
}

// ---- 路由 ----

func (a *app) routes() http.Handler {
	mux := http.NewServeMux()

	// ===== 认证 =====
	mux.HandleFunc("POST /api/auth/register", a.handleRegister)
	mux.HandleFunc("POST /api/auth/login", a.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", a.requireUser(a.handleLogout))

	// ===== 系统设置（GET 完全公开——登录/注册页也需要；写需 admin）=====
	mux.HandleFunc("GET /api/settings", a.handleGetSettings)
	mux.HandleFunc("PUT /api/settings/public-mode", a.requireRole(RoleAdmin, a.handlePutPublicMode))

	// ===== 个人中心 =====
	mux.HandleFunc("GET /api/me", a.requireUser(a.handleGetMe))
	mux.HandleFunc("PUT /api/me", a.requireUser(a.handleUpdateMe))

	// ===== 用户管理（admin）=====
	mux.HandleFunc("GET /api/users", a.requireRole(RoleAdmin, a.handleListUsers))
	mux.HandleFunc("PUT /api/users/{id}/role", a.requireRole(RoleAdmin, a.handleSetUserRole))
	mux.HandleFunc("PUT /api/users/{id}/disabled", a.requireRole(RoleAdmin, a.handleSetUserDisabled))

	// ===== 任务 =====
	mux.HandleFunc("GET /api/tasks", a.gateRead(a.handleListTasks))
	mux.HandleFunc("POST /api/tasks", a.gateWrite(a.handleCreateTask))
	mux.HandleFunc("PATCH /api/tasks/{id}", a.gateWrite(a.handleTaskPatch))
	mux.HandleFunc("DELETE /api/tasks/{id}", a.gateWrite(a.handleSoftDeleteTask))
	mux.HandleFunc("PUT /api/tasks/reorder", a.gateWrite(a.handleReorder))

	mux.HandleFunc("POST /api/tasks/{id}/claim", a.gateWrite(a.handleClaim))
	mux.HandleFunc("DELETE /api/tasks/{id}/claim", a.gateWrite(a.handleUnclaim))
	mux.HandleFunc("POST /api/tasks/{id}/progress", a.gateWrite(a.handleAddProgress))
	mux.HandleFunc("PUT /api/progress/{pid}", a.gateWrite(a.handleUpdateProgress))
	mux.HandleFunc("DELETE /api/progress/{pid}", a.gateWrite(a.handleDeleteProgress))
	mux.HandleFunc("POST /api/tasks/{id}/deps", a.gateWrite(a.handleAddDep))
	mux.HandleFunc("DELETE /api/tasks/{id}/deps/{depId}", a.gateWrite(a.handleRemoveDep))
	mux.HandleFunc("GET /api/tasks/{id}/comments", a.gateRead(a.handleListComments))
	mux.HandleFunc("POST /api/tasks/{id}/comments", a.gateWrite(a.handleAddComment))
	mux.HandleFunc("PATCH /api/comments/{cid}", a.gateWrite(a.handleUpdateComment))
	mux.HandleFunc("DELETE /api/comments/{cid}", a.gateWrite(a.handleDeleteComment))

	// ===== 回收站（软删）=====
	mux.HandleFunc("GET /api/trash", a.gateRead(a.handleListTrash))
	mux.HandleFunc("POST /api/trash/{id}/restore", a.gateWrite(a.handleRestore))
	mux.HandleFunc("DELETE /api/trash/{id}", a.gateWrite(a.handlePurge))

	// ===== 动态 =====
	mux.HandleFunc("GET /api/activities", a.gateRead(a.handleActivities))
	mux.HandleFunc("GET /api/tasks/{id}/activities", a.gateRead(a.handleTaskActivities))
	mux.HandleFunc("GET /api/stats", a.gateRead(a.handleStats))

	// ===== SSE =====
	mux.HandleFunc("GET /api/events", a.handleEvents)

	return a.withCommon(mux)
}

// ---- 认证 handlers ----

func (a *app) handleRegister(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username    string `json:"username"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.DisplayName == "" {
		in.DisplayName = in.Username
	}
	user, first, err := a.store.Register(in.Username, in.Password, in.DisplayName)
	if err != nil {
		a.writeErr(w, 400, err.Error())
		return
	}
	tok, err := a.store.CreateSession(user.ID)
	if err != nil {
		a.writeErr(w, 500, "创建会话失败")
		return
	}
	// 首位注册者已是 admin（见 Register）
	_ = first
	a.writeJSON(w, 201, map[string]any{"token": tok, "user": user})
}

func (a *app) handleLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	user, ok, err := a.store.VerifyPassword(strings.TrimSpace(in.Username), in.Password)
	if err != nil || !ok {
		a.writeErr(w, 401, "用户名或密码错误")
		return
	}
	tok, err := a.store.CreateSession(user.ID)
	if err != nil {
		a.writeErr(w, 500, "创建会话失败")
		return
	}
	a.writeJSON(w, 200, map[string]any{"token": tok, "user": user})
}

func (a *app) handleLogout(w http.ResponseWriter, r *http.Request) {
	if tok := bearerToken(r); tok != "" {
		_ = a.store.DeleteSession(tok)
	}
	a.writeNoContent(w)
}

// ---- 设置 handlers ----

func (a *app) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	mode, err := a.store.PublicMode()
	if err != nil {
		a.writeErr(w, 500, "读取设置失败")
		return
	}
	a.writeJSON(w, 200, map[string]any{
		"publicMode": mode,
		"auth": map[string]any{
			"enabled":     true,
			"anonymous":   currentUser(r) == nil,
			"displayName": a.anonDisplayName(r),
		},
	})
}

func (a *app) anonDisplayName(r *http.Request) string {
	if u := currentUser(r); u != nil {
		return u.DisplayName
	}
	return ""
}

func (a *app) handlePutPublicMode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Mode string `json:"publicMode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	switch in.Mode {
	case ModePrivate, ModeReadonly, ModeOpen:
	default:
		a.writeErr(w, 400, "公开度取值无效：private/readonly/open")
		return
	}
	if err := a.store.SetSetting(SettingPublicMode, in.Mode); err != nil {
		a.writeErr(w, 500, "保存设置失败")
		return
	}
	a.writeJSON(w, 200, map[string]any{"publicMode": in.Mode})
}

// ---- 个人中心 handlers ----

func (a *app) handleGetMe(w http.ResponseWriter, r *http.Request) {
	a.writeJSON(w, 200, currentUser(r))
}

func (a *app) handleUpdateMe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName string `json:"displayName"`
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	me := currentUser(r)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	if in.DisplayName == "" {
		a.writeErr(w, 400, "展示名不能为空")
		return
	}
	if in.NewPassword != "" {
		ok, err := a.store.CheckPassword(me.ID, in.OldPassword)
		if err != nil {
			a.writeErr(w, 500, "校验密码失败")
			return
		}
		if !ok {
			a.writeErr(w, 400, "旧密码错误")
			return
		}
	}
	updated, err := a.store.UpdateSelf(me.ID, in.DisplayName, in.NewPassword)
	if err != nil {
		a.writeErr(w, 500, "更新失败: "+err.Error())
		return
	}
	a.writeJSON(w, 200, updated)
}

// ---- 用户管理 handlers ----

func (a *app) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListUsers()
	if err != nil {
		a.writeErr(w, 500, "读取用户失败")
		return
	}
	a.writeJSON(w, 200, users)
}

func (a *app) handleSetUserRole(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	me := currentUser(r)
	if me.ID == id && in.Role != RoleAdmin {
		a.writeErr(w, 400, "不能降级自己的管理员角色")
		return
	}
	if err := a.store.SetUserRole(id, in.Role); err != nil {
		a.writeErr(w, 400, err.Error())
		return
	}
	a.writeNoContent(w)
}

func (a *app) handleSetUserDisabled(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		Disabled bool `json:"disabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	me := currentUser(r)
	if me.ID == id {
		a.writeErr(w, 400, "不能停用自己")
		return
	}
	if err := a.store.SetUserDisabled(id, in.Disabled); err != nil {
		a.writeErr(w, 500, "操作失败")
		return
	}
	a.writeNoContent(w)
}

// ---- 任务 handlers ----

func (a *app) handleListTasks(w http.ResponseWriter, r *http.Request) {
	includeArchived := r.URL.Query().Get("archived") == "1" || r.URL.Query().Get("includeArchived") == "true"
	tasks, err := a.store.ListTasks(includeArchived)
	if err != nil {
		a.writeErr(w, 500, "读取任务失败: "+err.Error())
		return
	}
	a.writeJSON(w, 200, tasks)
}

func (a *app) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var in TaskInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		a.writeErr(w, 400, "任务标题不能为空")
		return
	}
	if in.Status == "" {
		in.Status = StatusTodo
	}
	if !validStatus(in.Status) {
		a.writeErr(w, 400, "无效的状态")
		return
	}
	uid, _ := writeAuthor(r)
	ts := now()
	t := Task{
		ID:        newID(),
		Title:     in.Title,
		Content:   in.Content,
		Status:    in.Status,
		DueDate:   in.DueDate,
		Tags:      in.Tags,
		CreatedBy: uid,
		CreatedAt: ts,
		UpdatedAt: ts,
	}
	created, err := a.store.CreateTask(t)
	if err != nil {
		a.writeErr(w, 500, "创建任务失败: "+err.Error())
		return
	}
	if uid != "" {
		a.recordActivity(r, "created", "task", created.ID)
	}
	a.writeJSON(w, 201, created)
}

func (a *app) handleReorder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status Status   `json:"status"`
		IDs    []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	if !validStatus(in.Status) || len(in.IDs) == 0 {
		a.writeErr(w, 400, "status 或 ids 无效")
		return
	}
	if err := a.store.ReorderTasks(in.Status, in.IDs); err != nil {
		a.writeErr(w, 500, "排序失败: "+err.Error())
		return
	}
	a.recordActivity(r, "reordered", "task", "")
	a.hub.publish("")
	a.writeNoContent(w)
}

// handleSoftDeleteTask 软删任务 → 回收站。
// 权限：admin 可删任意；member 仅限删除自己创建的任务（契约见 docs/api-contract.md）。
func (a *app) handleSoftDeleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := a.store.GetTask(id)
	if err != nil || existing == nil {
		a.writeErr(w, 404, "任务不存在")
		return
	}
	u := currentUser(r)
	if u != nil && u.Role != RoleAdmin {
		if existing.CreatedBy == "" || existing.CreatedBy != u.ID {
			a.writeErr(w, 403, "只能删除自己创建的任务")
			return
		}
	}
	if err := a.store.SoftDeleteTask(id); err != nil {
		a.writeErr(w, 500, "删除失败: "+err.Error())
		return
	}
	a.recordActivity(r, "deleted", "task", id)
	a.writeNoContent(w)
}

// handleStats 看板统计（只读：登录用户或公开模式匿名均可访问，经 gateRead 放行）。
func (a *app) handleStats(w http.ResponseWriter, r *http.Request) {
	stats, err := a.store.Stats()
	if err != nil {
		a.writeErr(w, 500, "读取统计失败: "+err.Error())
		return
	}
	a.writeJSON(w, 200, stats)
}

// ---- 认领 / 进度 / 依赖 ----

func (a *app) handleClaim(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	uid := a.currentUserID(r)
	if uid == "" {
		a.writeErr(w, 401, "未登录")
		return
	}
	exists, err := a.store.ClaimExists(id, uid)
	if err != nil {
		a.writeErr(w, 500, "查询认领失败")
		return
	}
	if exists {
		a.writeErr(w, 409, "你已经认领过该任务")
		return
	}
	if err := a.store.AddClaim(id, uid); err != nil {
		a.writeErr(w, 500, "认领失败: "+err.Error())
		return
	}
	a.recordActivity(r, "claimed", "task", id)
	a.writeNoContent(w)
}

func (a *app) handleUnclaim(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	uid := a.currentUserID(r)
	if uid == "" {
		a.writeErr(w, 401, "未登录")
		return
	}
	if err := a.store.RemoveClaim(id, uid); err != nil {
		a.writeErr(w, 500, "取消认领失败: "+err.Error())
		return
	}
	a.recordActivity(r, "unclaimed", "task", id)
	a.writeNoContent(w)
}

func (a *app) handleAddProgress(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	uid := a.currentUserID(r)
	if uid == "" {
		a.writeErr(w, 401, "未登录")
		return
	}
	var in struct {
		Percent int    `json:"percent"`
		Text    string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	if in.Percent < 0 || in.Percent > 100 {
		a.writeErr(w, 400, "进度百分比需在 0-100 之间")
		return
	}
	ts := now()
	p := Progress{ID: newID(), TaskID: id, UserID: uid, Percent: in.Percent, Text: in.Text, CreatedAt: ts, UpdatedAt: ts}
	if err := a.store.AddProgress(p); err != nil {
		a.writeErr(w, 500, "添加进度失败: "+err.Error())
		return
	}
	a.recordActivity(r, "progress", "task", id)
	// 返回完整记录（含 author 展示名）
	created, _ := a.store.GetProgress(p.ID)
	if created == nil {
		created = &p
	}
	a.writeJSON(w, 201, created)
}

func (a *app) handleUpdateProgress(w http.ResponseWriter, r *http.Request) {
	pid := r.PathValue("pid")
	p, err := a.store.GetProgress(pid)
	if err != nil || p == nil {
		a.writeErr(w, 404, "进度记录不存在")
		return
	}
	uid := a.currentUserID(r)
	if uid == "" || p.UserID != uid {
		a.writeErr(w, 403, "只能修改自己创建的进度记录")
		return
	}
	var in struct {
		Percent int    `json:"percent"`
		Text    string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	if in.Percent < 0 || in.Percent > 100 {
		a.writeErr(w, 400, "进度百分比需在 0-100 之间")
		return
	}
	p.Percent = in.Percent
	p.Text = in.Text
	p.UpdatedAt = now()
	if err := a.store.UpdateProgress(*p); err != nil {
		a.writeErr(w, 500, "更新失败: "+err.Error())
		return
	}
	a.recordActivity(r, "progress_updated", "task", p.TaskID)
	a.writeJSON(w, 200, p)
}

func (a *app) handleDeleteProgress(w http.ResponseWriter, r *http.Request) {
	pid := r.PathValue("pid")
	p, err := a.store.GetProgress(pid)
	if err != nil || p == nil {
		a.writeErr(w, 404, "进度记录不存在")
		return
	}
	uid := a.currentUserID(r)
	if uid == "" || p.UserID != uid {
		a.writeErr(w, 403, "只能删除自己创建的进度记录")
		return
	}
	if err := a.store.DeleteProgress(pid); err != nil {
		a.writeErr(w, 500, "删除失败: "+err.Error())
		return
	}
	a.recordActivity(r, "progress_deleted", "task", p.TaskID)
	a.writeNoContent(w)
}

// ---- 评论 ----

// listComments 读某任务评论（读操作，gateRead 已在路由层鉴权）。
func (a *app) handleListComments(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	comments, err := a.store.ListComments(id)
	if err != nil {
		a.writeErr(w, 500, "读取评论失败: "+err.Error())
		return
	}
	a.writeJSON(w, 200, comments)
}

func (a *app) handleAddComment(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	uid := a.currentUserID(r)
	var in struct {
		Content  string `json:"content"`
		ParentID string `json:"parentId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	in.Content = strings.TrimSpace(in.Content)
	if in.Content == "" || len(in.Content) > 2000 {
		a.writeErr(w, 400, "评论内容需为 1-2000 字符")
		return
	}
	// 任务必须存在（防孤儿；软删/归档任务仍可评论——以任务本体存在为准）
	task, err := a.store.GetTask(id)
	if err != nil || task == nil {
		a.writeErr(w, 404, "任务不存在")
		return
	}
	// 父评论校验：必须在同一任务
	if in.ParentID != "" {
		parent, err := a.store.GetComment(in.ParentID)
		if err != nil || parent == nil {
			a.writeErr(w, 404, "回复的评论不存在")
			return
		}
		if parent.TaskID != id {
			a.writeErr(w, 400, "回复的评论不属于该任务")
			return
		}
		// 回复的回复归一到顶层评论下（单层回复约束）
		if parent.ParentID != "" {
			in.ParentID = parent.ParentID
		}
	}
	ts := now()
	c := Comment{ID: newID(), TaskID: id, UserID: uid, ParentID: in.ParentID,
		Content: in.Content, CreatedAt: ts, UpdatedAt: ts}
	if err := a.store.AddComment(c); err != nil {
		a.writeErr(w, 500, "发表评论失败: "+err.Error())
		return
	}
	created, _ := a.store.GetComment(c.ID)
	if created == nil {
		created = &c
	}
	a.hub.publish(id) // SSE：其他端刷新该任务
	a.writeJSON(w, 201, created)
}

func (a *app) handleUpdateComment(w http.ResponseWriter, r *http.Request) {
	cid := r.PathValue("cid")
	c, err := a.store.GetComment(cid)
	if err != nil || c == nil {
		a.writeErr(w, 404, "评论不存在")
		return
	}
	uid := a.currentUserID(r)
	if uid == "" || c.UserID != uid {
		a.writeErr(w, 403, "只能编辑自己的评论")
		return
	}
	var in struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	in.Content = strings.TrimSpace(in.Content)
	if in.Content == "" || len(in.Content) > 2000 {
		a.writeErr(w, 400, "评论内容需为 1-2000 字符")
		return
	}
	if err := a.store.UpdateComment(cid, in.Content, now()); err != nil {
		a.writeErr(w, 500, "更新评论失败: "+err.Error())
		return
	}
	c.Content = in.Content
	c.UpdatedAt = now()
	a.hub.publish(c.TaskID)
	a.writeJSON(w, 200, c)
}

func (a *app) handleDeleteComment(w http.ResponseWriter, r *http.Request) {
	cid := r.PathValue("cid")
	c, err := a.store.GetComment(cid)
	if err != nil || c == nil {
		a.writeErr(w, 404, "评论不存在")
		return
	}
	uid := a.currentUserID(r)
	// 作者本人或管理员可删（含级联删除其回复）
	u := currentUser(r)
	if uid == "" || c.UserID != uid && !(u != nil && u.Role == RoleAdmin) {
		a.writeErr(w, 403, "只能删除自己的评论")
		return
	}
	if err := a.store.DeleteComment(cid); err != nil {
		a.writeErr(w, 500, "删除评论失败: "+err.Error())
		return
	}
	a.hub.publish(c.TaskID)
	a.writeNoContent(w)
}

func (a *app) handleAddDep(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in struct {
		DepID string `json:"depId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	in.DepID = strings.TrimSpace(in.DepID)
	if in.DepID == "" {
		a.writeErr(w, 400, "缺少依赖任务")
		return
	}
	dep, err := a.store.GetTask(in.DepID)
	if err != nil || dep == nil {
		a.writeErr(w, 404, "依赖任务不存在")
		return
	}
	cycle, err := a.store.WouldCycle(id, in.DepID)
	if err != nil {
		a.writeErr(w, 500, "检查依赖失败")
		return
	}
	if cycle {
		a.writeErr(w, 409, "添加该依赖会形成循环")
		return
	}
	if err := a.store.AddDep(id, in.DepID); err != nil {
		a.writeErr(w, 500, "添加依赖失败: "+err.Error())
		return
	}
	a.recordActivity(r, "dep_added", "task", id)
	a.writeNoContent(w)
}

func (a *app) handleRemoveDep(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	depID := r.PathValue("depId")
	if err := a.store.RemoveDep(id, depID); err != nil {
		a.writeErr(w, 500, "移除依赖失败: "+err.Error())
		return
	}
	a.recordActivity(r, "dep_removed", "task", id)
	a.writeNoContent(w)
}

// ---- 回收站 handlers ----

func (a *app) handleListTrash(w http.ResponseWriter, r *http.Request) {
	tasks, err := a.store.ListTrash()
	if err != nil {
		a.writeErr(w, 500, "读取回收站失败")
		return
	}
	a.writeJSON(w, 200, tasks)
}

func (a *app) handleRestore(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := a.store.GetTrashTask(id)
	if err != nil || existing == nil {
		a.writeErr(w, 404, "回收站中不存在该任务")
		return
	}
	if err := a.store.RestoreTask(id); err != nil {
		a.writeErr(w, 500, "恢复失败: "+err.Error())
		return
	}
	a.recordActivity(r, "restored", "task", id)
	a.writeJSON(w, 200, map[string]string{"id": id})
}

// handlePurge 彻底删除：admin 或创建者可执行；物理删走外键 CASCADE 级联清理关联表。
// 动态记录在删除前写入（任务标题快照保留）。
func (a *app) handlePurge(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := a.store.GetTrashTask(id)
	if err != nil || existing == nil {
		a.writeErr(w, 404, "回收站中不存在该任务")
		return
	}
	u := currentUser(r)
	if u == nil {
		a.writeErr(w, 401, "未登录")
		return
	}
	isAdmin := u.Role == RoleAdmin
	isCreator := existing.CreatedBy != "" && existing.CreatedBy == u.ID
	if !isAdmin && !isCreator {
		a.writeErr(w, 403, "只有管理员或任务创建者可以彻底删除")
		return
	}
	userID, _ := writeAuthor(r)
	if userID != "" {
		act := Activity{
			ID:        newID(),
			Action:    "purged",
			Target:    "task",
			TargetID:  id,
			TaskTitle: existing.Title, // 快照：删除后 title 即不可查
			UserID:    userID,
			CreatedAt: now(),
		}
		if err := a.store.AddActivity(act); err != nil {
			log.Warn().Err(err).Msg("record activity (purge)")
		}
	}
	if err := a.store.DeleteTask(id); err != nil {
		a.writeErr(w, 500, "彻底删除失败: "+err.Error())
		return
	}
	a.hub.publish(id)
	a.writeNoContent(w)
}

// ---- 动态 / SSE ----

func (a *app) handleActivities(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	acts, err := a.store.ListActivities(limit)
	if err != nil {
		a.writeErr(w, 500, "读取动态失败: "+err.Error())
		return
	}
	a.writeJSON(w, 200, acts)
}

// handleTaskActivities 某任务的操作时间线（完整历史，非全局最近截断）。
func (a *app) handleTaskActivities(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	acts, err := a.store.ListActivitiesByTask(id, limit)
	if err != nil {
		a.writeErr(w, 500, "读取任务动态失败: "+err.Error())
		return
	}
	a.writeJSON(w, 200, acts)
}

func (a *app) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		a.writeErr(w, 500, "SSE 不支持")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	ch := a.hub.add()
	defer a.hub.remove(ch)
	// initial ping so client can confirm connection
	fmt.Fprintf(w, "event: ready\ndata: {}\n\n")
	flusher.Flush()
	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		case <-heartbeat.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}

// ---- PATCH handler with pointer patch model ----

type taskPatch struct {
	Title    *string         `json:"title"`
	Content  *string         `json:"content"`
	Status   *Status         `json:"status"`
	Position *float64        `json:"position"`
	DueDate  json.RawMessage `json:"dueDate"` // "YYYY-MM-DD" | null（显式清除）| 缺省（无字段）
	Tags     *[]string       `json:"tags"`
	Archived *bool           `json:"archived"`
}

func (a *app) handleTaskPatch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := a.store.GetTask(id)
	if err != nil || existing == nil {
		a.writeErr(w, 404, "任务不存在")
		return
	}
	var p taskPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		a.writeErr(w, 400, "请求体解析失败")
		return
	}
	if p.Title != nil {
		title := strings.TrimSpace(*p.Title)
		if title == "" {
			a.writeErr(w, 400, "任务标题不能为空")
			return
		}
		existing.Title = title
	}
	if p.Content != nil {
		existing.Content = *p.Content
	}
	if p.Status != nil {
		if !validStatus(*p.Status) {
			a.writeErr(w, 400, "无效的状态")
			return
		}
		existing.Status = *p.Status
	}
	if p.Position != nil {
		existing.Position = *p.Position
	}
	if len(p.DueDate) > 0 { // 字段出现在 JSON 中：null 或 "YYYY-MM-DD"
		if string(p.DueDate) == "null" {
			existing.DueDate = nil
		} else {
			var s string
			if err := json.Unmarshal(p.DueDate, &s); err == nil {
				if s == "" {
					existing.DueDate = nil
				} else {
					existing.DueDate = &s
				}
			}
		}
	}
	if p.Tags != nil {
		existing.Tags = *p.Tags
	}
	if p.Archived != nil {
		existing.Archived = *p.Archived
	}
	existing.UpdatedAt = now()
	if err := a.store.UpdateTask(*existing); err != nil {
		a.writeErr(w, 500, "更新失败: "+err.Error())
		return
	}
	a.recordActivity(r, "updated", "task", id)
	a.hub.publish(id)
	updated, err := a.store.GetTask(id)
	if err != nil {
		a.writeErr(w, 500, "读取更新结果失败")
		return
	}
	a.writeJSON(w, 200, updated)
}

// withCommon adds CORS (dev convenience), 统一 Bearer 鉴权与请求日志。
// 鉴权放在最外层：内层 requireUser/gateWrite 的 tryAuth 幂等复用其结果，
// 保证访问日志能记录真实操作者（而非一律 anon）。
func (a *app) withCommon(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Author, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		rr := r
		if bearerToken(r) != "" {
			if authed, err := a.tryAuth(r); err != nil {
				log.Warn().Err(err).Msg("auth precheck")
			} else {
				rr = authed
			}
		}
		start := time.Now()
		next.ServeHTTP(w, rr)
		who := "anon"
		role := "-"
		if u := currentUser(rr); u != nil {
			who = u.DisplayName
			role = u.Role
		}
		log.Debug().Str("method", r.Method).Str("path", r.URL.Path).
			Str("user", who).Str("role", role).
			Dur("dur", time.Since(start)).Msg("http")
	})
}
