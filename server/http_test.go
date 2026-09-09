package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// newTestApp 起一个内存测试服务（httptest），返回 app 与 handler。
func newTestApp(t *testing.T) *app {
	t.Helper()
	s := newTestStore(t)
	a := &app{store: s, hub: newHub()}
	return a
}

// regHTTP 注册用户并返回可用 token。
func regHTTP(t *testing.T, a *app, username string) string {
	t.Helper()
	body := strings.NewReader(`{"username":"` + username + `","password":"pass1234","displayName":"展示` + username + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("register %s: %d %s", username, rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Token
}

func doReq(a *app, method, path, token, payload string) *httptest.ResponseRecorder {
	var body *strings.Reader
	if payload == "" {
		body = strings.NewReader("")
	} else {
		body = strings.NewReader(payload)
	}
	req := httptest.NewRequest(method, path, body)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	a.routes().ServeHTTP(rec, req)
	return rec
}

// TestSoftDeleteOwnership 软删权限回归：member 只能删自己创建的任务；
// 其他 member（非创建者）删除 → 403；admin 可删任意。
func TestSoftDeleteOwnership(t *testing.T) {
	a := newTestApp(t)
	// 首个注册为 admin
	adminTok := regHTTP(t, a, "admin1")
	bobTok := regHTTP(t, a, "bob")
	carolTok := regHTTP(t, a, "carol")

	// bob 创建任务
	rec := doReq(a, http.MethodPost, "/api/tasks", bobTok, `{"title":"bob的任务","tags":[]}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var created Task
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	// carol（member，非创建者）软删 → 403
	rec = doReq(a, http.MethodDelete, "/api/tasks/"+created.ID, carolTok, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("carol delete others task: want 403 got %d %s", rec.Code, rec.Body.String())
	}
	// bob 删自己的 → 204
	rec = doReq(a, http.MethodDelete, "/api/tasks/"+created.ID, bobTok, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("bob delete own task: want 204 got %d %s", rec.Code, rec.Body.String())
	}

	// 再造一条，admin 可删任意
	rec = doReq(a, http.MethodPost, "/api/tasks", bobTok, `{"title":"bob任务2"}`)
	if rec.Code != http.StatusCreated {
		t.Fatal("create second task failed")
	}
	var created2 Task
	_ = json.Unmarshal(rec.Body.Bytes(), &created2)
	rec = doReq(a, http.MethodDelete, "/api/tasks/"+created2.ID, adminTok, "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("admin delete others task: want 204 got %d %s", rec.Code, rec.Body.String())
	}
}

// TestStatsEndpoint /api/stats 返回完整统计结构且字段合理。
func TestStatsEndpoint(t *testing.T) {
	a := newTestApp(t)
	regHTTP(t, a, "alice") // admin

	ts := time.Now().UTC().Format(time.RFC3339)
	_ = ts
	// 造 2 任务 1 认领
	tok := regHTTP(t, a, "worker")
	rec := doReq(a, http.MethodPost, "/api/tasks", tok, `{"title":"统计任务A","tags":["后端"]}`)
	if rec.Code != http.StatusCreated {
		t.Fatal("create A failed")
	}
	var t1 Task
	_ = json.Unmarshal(rec.Body.Bytes(), &t1)
	rec = doReq(a, http.MethodPost, "/api/tasks", tok, `{"title":"统计任务B","tags":["后端","前端"],"dueDate":"2020-01-01"}`)
	if rec.Code != http.StatusCreated {
		t.Fatal("create B failed")
	}
	rec = doReq(a, http.MethodPost, "/api/tasks/"+t1.ID+"/claim", tok, "")
	if rec.Code != http.StatusNoContent {
		t.Fatal("claim failed")
	}

	// 匿名在 private 下访问 stats → 401
	rec = doReq(a, http.MethodGet, "/api/stats", "", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous stats: want 401 got %d", rec.Code)
	}
	// 登录访问 → 200 且结构完整
	rec = doReq(a, http.MethodGet, "/api/stats", tok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
	}
	var st Stats
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.TaskTotal != 2 || st.Overdue != 1 || len(st.ByTag) == 0 || st.ByMember == nil {
		t.Fatalf("stats 结构异常: %+v", st)
	}
}

// TestAbandonedStatusAPI 废弃状态 API 契约：PATCH 迁移到 abandoned 生效、
// 统计单列计数、非法状态仍被拒。
func TestAbandonedStatusAPI(t *testing.T) {
	a := newTestApp(t)
	tok := regHTTP(t, a, "boss")

	rec := doReq(a, http.MethodPost, "/api/tasks", tok, `{"title":"先不做"}`)
	if rec.Code != http.StatusCreated {
		t.Fatal("create failed")
	}
	var tk Task
	_ = json.Unmarshal(rec.Body.Bytes(), &tk)

	// 非法状态拒绝
	rec = doReq(a, http.MethodPatch, "/api/tasks/"+tk.ID, tok, `{"status":"bogus"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("非法状态 want 400 got %d", rec.Code)
	}
	// 迁到废弃
	rec = doReq(a, http.MethodPatch, "/api/tasks/"+tk.ID, tok, `{"status":"abandoned"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch abandoned: %d %s", rec.Code, rec.Body.String())
	}
	var got Task
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusAbandoned {
		t.Fatalf("status=%s, want abandoned", got.Status)
	}

	// 统计：废弃单列计数，活跃口径归零
	rec = doReq(a, http.MethodGet, "/api/stats", tok, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("stats: %d", rec.Code)
	}
	var st Stats
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if st.Abandoned != 1 || st.TaskTotal != 0 {
		t.Fatalf("stats: %+v", st)
	}
}

// TestGuideEndpoint /api/guide 公开返回内嵌 AI 使用指南（供 MCP 双通道拉取）。
func TestGuideEndpoint(t *testing.T) {
	a := newTestApp(t)
	// 公开：匿名（private 模式）也能读
	rec := doReq(a, http.MethodGet, "/api/guide", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("guide: want 200 got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/markdown; charset=utf-8" {
		t.Fatalf("guide content-type: %s", ct)
	}
	body := rec.Body.String()
	if len(body) < 500 || !strings.Contains(body, "status") || !strings.Contains(body, "abandoned") {
		t.Fatalf("guide 内容异常（长度 %d）", len(body))
	}
}

// loginHTTP 登录并返回 token（失败即测试失败）。
func loginHTTP(t *testing.T, a *app, username, password string) string {
	t.Helper()
	rec := doReq(a, http.MethodPost, "/api/auth/login", "",
		`{"username":"`+username+`","password":"`+password+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("login %s: %d %s", username, rec.Code, rec.Body.String())
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Token
}

// TestAdminCreateUserEndpoint POST /api/users 管理员代建账号：201 返回用户、密码可登录、
// 角色缺省 member、重名 400；非 admin 403。
func TestAdminCreateUserEndpoint(t *testing.T) {
	a := newTestApp(t)
	adminTok := regHTTP(t, a, "boss") // 首个注册为 admin
	memberTok := regHTTP(t, a, "mid")

	// member 无权限 → 403
	rec := doReq(a, http.MethodPost, "/api/users", memberTok, `{"username":"x","password":"x12345"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("member create user: want 403 got %d", rec.Code)
	}

	// admin 代建（缺省 member）
	rec = doReq(a, http.MethodPost, "/api/users", adminTok,
		`{"username":"carol","password":"carol1234","displayName":"Carol"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create user: %d %s", rec.Code, rec.Body.String())
	}
	var u User
	if err := json.Unmarshal(rec.Body.Bytes(), &u); err != nil {
		t.Fatal(err)
	}
	if u.Role != RoleMember || u.Username != "carol" {
		t.Fatalf("created user 异常: %+v", u)
	}
	// 初始密码可直接登录
	if tok := loginHTTP(t, a, "carol", "carol1234"); tok == "" {
		t.Fatal("代建用户初始密码应可登录")
	}
	// 指定角色
	rec = doReq(a, http.MethodPost, "/api/users", adminTok,
		`{"username":"vic","password":"vic12345","role":"viewer"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create viewer: %d %s", rec.Code, rec.Body.String())
	}
	var v User
	_ = json.Unmarshal(rec.Body.Bytes(), &v)
	if v.Role != RoleViewer {
		t.Fatalf("role=%s, want viewer", v.Role)
	}
	// 重名 → 400
	rec = doReq(a, http.MethodPost, "/api/users", adminTok,
		`{"username":"carol","password":"other123"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "占用") {
		t.Fatalf("重名代建: want 400 占用 got %d %s", rec.Code, rec.Body.String())
	}
	// 短密码 → 400
	rec = doReq(a, http.MethodPost, "/api/users", adminTok, `{"username":"shorty","password":"123"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("短密码代建: want 400 got %d", rec.Code)
	}
}

// TestResetPasswordEndpoint PUT /api/users/{id}/password：管理员重置后旧密码失效、新密码可登录；
// 自重置 400、非 admin 403、短密码 400。
func TestResetPasswordEndpoint(t *testing.T) {
	a := newTestApp(t)
	adminTok := regHTTP(t, a, "boss")
	memberTok := regHTTP(t, a, "mid")

	// 取 mid 的 id
	rec := doReq(a, http.MethodGet, "/api/users", adminTok, "")
	if rec.Code != http.StatusOK {
		t.Fatal("list users failed")
	}
	var users []User
	if err := json.Unmarshal(rec.Body.Bytes(), &users); err != nil {
		t.Fatal(err)
	}
	var mid *User
	for i := range users {
		if users[i].Username == "mid" {
			mid = &users[i]
			break
		}
	}
	if mid == nil {
		t.Fatal("mid 不在用户列表")
	}

	// member 无权重置他人 → 403
	rec = doReq(a, http.MethodPut, "/api/users/"+mid.ID+"/password", memberTok, `{"password":"hack1234"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("member reset: want 403 got %d", rec.Code)
	}
	// 短密码 → 400
	rec = doReq(a, http.MethodPut, "/api/users/"+mid.ID+"/password", adminTok, `{"password":"123"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("短密码重置: want 400 got %d", rec.Code)
	}
	// 自重置 → 400（管理员不能通过用户管理改自己，须走个人中心）
	rec = doReq(a, http.MethodGet, "/api/users", adminTok, "")
	var list []User
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	var boss *User
	for i := range list {
		if list[i].Username == "boss" {
			boss = &list[i]
			break
		}
	}
	if boss == nil {
		t.Fatal("boss 不在用户列表")
	}
	rec = doReq(a, http.MethodPut, "/api/users/"+boss.ID+"/password", adminTok, `{"password":"newboss123"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "自己") {
		t.Fatalf("自重置: want 400 提示自己 got %d %s", rec.Code, rec.Body.String())
	}

	// 正常重置
	rec = doReq(a, http.MethodPut, "/api/users/"+mid.ID+"/password", adminTok, `{"password":"fresh9876"}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("reset: want 204 got %d %s", rec.Code, rec.Body.String())
	}
	// 旧密码（regHTTP 的 mid 密码为 pass1234）失效、新密码可登录
	rec = doReq(a, http.MethodPost, "/api/auth/login", "", `{"username":"mid","password":"pass1234"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("旧密码应失效: got %d", rec.Code)
	}
	if tok := loginHTTP(t, a, "mid", "fresh9876"); tok == "" {
		t.Fatal("新密码应可登录")
	}
}

// TestRegistrationToggleEndpoint 注册开关：默认开放；admin 关闭后匿名注册 403、
// 管理端代建不受影响、GET /api/settings 反映状态；非 admin 无权改；重开恢复注册。
func TestRegistrationToggleEndpoint(t *testing.T) {
	a := newTestApp(t)
	adminTok := regHTTP(t, a, "boss") // 首个注册为 admin
	memberTok := regHTTP(t, a, "mid")

	// GET 默认开放
	rec := doReq(a, http.MethodGet, "/api/settings", "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("settings: %d", rec.Code)
	}
	var st struct {
		PublicMode   string `json:"publicMode"`
		Registration bool   `json:"registration"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if !st.Registration {
		t.Fatal("默认应开放注册")
	}

	// 非 admin 修改 → 403
	rec = doReq(a, http.MethodPut, "/api/settings/registration", memberTok, `{"registration":false}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("member 改注册开关: want 403 got %d", rec.Code)
	}
	// 缺 registration 字段 → 400
	rec = doReq(a, http.MethodPut, "/api/settings/registration", adminTok, `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("缺字段: want 400 got %d", rec.Code)
	}

	// 关闭 → 匿名注册 403，登录页仍能读 settings
	rec = doReq(a, http.MethodPut, "/api/settings/registration", adminTok, `{"registration":false}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("close registration: %d %s", rec.Code, rec.Body.String())
	}
	rec = doReq(a, http.MethodPost, "/api/auth/register", "", `{"username":"intruder","password":"int12345"}`)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "注册已关闭") {
		t.Fatalf("关闭后注册: want 403 注册已关闭 got %d %s", rec.Code, rec.Body.String())
	}
	rec = doReq(a, http.MethodGet, "/api/settings", "", "")
	var st2 struct {
		Registration bool `json:"registration"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &st2)
	if st2.Registration {
		t.Fatal("GET settings 应反映已关闭")
	}
	// 已登录用户与 admin 代建不受影响
	loginHTTP(t, a, "mid", "pass1234")
	rec = doReq(a, http.MethodPost, "/api/users", adminTok, `{"username":"carol","password":"carol1234"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("注册关闭后代建应可用: %d %s", rec.Code, rec.Body.String())
	}

	// 重开 → 自助注册恢复
	rec = doReq(a, http.MethodPut, "/api/settings/registration", adminTok, `{"registration":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reopen: %d", rec.Code)
	}
	rec = doReq(a, http.MethodPost, "/api/auth/register", "", `{"username":"dave","password":"dave12345"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("重开后注册: want 201 got %d %s", rec.Code, rec.Body.String())
	}
}
