package main

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

// TestReportEventsWindowAndMembers 覆盖报表事件查询：
//   - [from,to) 半开窗口过滤（越界排除）
//   - 成员过滤（空=全部）
//   - detail JSON 随行返回
//   - 非 task 目标排除、匿名（user_id NULL）排除
func TestReportEventsWindowAndMembers(t *testing.T) {
	s := newTestStore(t)
	u1 := reg(t, s, "alice")
	u2 := reg(t, s, "bob")

	add := func(at, action, targetID string, userID string, detail string) {
		t.Helper()
		if err := s.AddActivity(Activity{
			ID: newID(), Action: action, Target: "task", TargetID: targetID,
			TaskTitle: "任务" + targetID, UserID: userID, Detail: detail, CreatedAt: at,
		}); err != nil {
			t.Fatal(err)
		}
	}
	// 窗口内 alice 两条（progress + status_changed）
	add("2026-09-02T03:00:00Z", "progress", "t1", u1.ID, `{"p":60,"text":"联调"}`)
	add("2026-09-02T09:00:00Z", "updated", "t1", u1.ID, `{"f":"in_progress","t":"done"}`)
	// 窗口边界:from 精确命中、to 精确排除
	add("2026-09-01T00:00:00Z", "claimed", "t2", u2.ID, `{"who":"x"}`) // = from → 含
	add("2026-09-05T00:00:00Z", "claimed", "t3", u1.ID, "")            // = to → 不含
	// 窗口外
	add("2026-08-31T23:59:59Z", "created", "t0", u2.ID, `{"title":"旧"}`)
	add("2026-09-05T00:00:01Z", "unclaimed", "t3", u1.ID, "")
	// 非 task 目标 + 匿名：都应被排除
	add("2026-09-03T00:00:00Z", "created", "t4", "", `{"x":1}`) // user_id NULL
	if err := s.AddActivity(Activity{ID: newID(), Action: "foo", Target: "comment", TargetID: "c1",
		UserID: u1.ID, CreatedAt: "2026-09-03T00:00:00Z"}); err != nil {
		t.Fatal(err)
	}

	// 窗口内应得 3 条:alice 2 + bob claimed 1（边界 from 含）
	evs, err := s.ReportEvents("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 3 {
		t.Fatalf("want 3 events, got %d: %+v", len(evs), evs)
	}
	// 顺序按时间正序
	if evs[0].CreatedAt != "2026-09-01T00:00:00Z" || evs[1].CreatedAt != "2026-09-02T03:00:00Z" {
		t.Fatalf("unexpected order: %s %s", evs[0].CreatedAt, evs[1].CreatedAt)
	}
	// detail 随行且可解析
	if evs[1].Detail == "" {
		t.Fatal("want detail on progress event")
	}
	var d struct {
		P    int    `json:"p"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(evs[1].Detail), &d); err != nil || d.P != 60 || d.Text != "联调" {
		t.Fatalf("detail parse fail: %v %+v", err, d)
	}
	// 只查 alice：应 2 条
	evs2, err := s.ReportEvents("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", []string{u1.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(evs2) != 2 {
		t.Fatalf("want 2 alice events, got %d", len(evs2))
	}
	for _, e := range evs2 {
		if e.UserID != u1.ID {
			t.Fatalf("member filter leak: %s", e.UserID)
		}
	}
}

// TestReportWindowParse 校验时间窗口解析与校验。
func TestReportWindowParse(t *testing.T) {
	// 合法 from<to
	if err := checkWindow(t, "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	// from>=to → 报错
	if err := checkWindow(t, "2026-09-05T00:00:00Z", "2026-09-01T00:00:00Z"); err == nil {
		t.Fatal("want window error when from>=to")
	}
	// 非法格式
	if err := checkWindow(t, "not-a-time", "2026-09-05T00:00:00Z"); err == nil {
		t.Fatal("want parse error on bad from")
	}
}

func checkWindow(t *testing.T, from, to string) error {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/reports/semiweekly?from="+from+"&to="+to, nil)
	_, _, err := parseReportWindow(req)
	return err
}
