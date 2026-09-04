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
