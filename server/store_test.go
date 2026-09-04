package main

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

// 每个测试独立临时库。
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenStore(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	s.Seed()
	t.Cleanup(func() { s.Close() })
	return s
}

// 注册并返回 User（首个为 admin）。
func reg(t *testing.T, s *Store, username string) *User {
	t.Helper()
	u, _, err := s.Register(username, username+"pass1", "展示"+username)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// TestListUsersNoDeadlock 回归：ListUsers 曾在 rows 未关时循环内查角色，
// 在 MaxOpenConns=1 下自死锁（整服僵死）。必须能返回多用户且不卡。
func TestListUsersNoDeadlock(t *testing.T) {
	s := newTestStore(t)
	for i := 0; i < 5; i++ {
		reg(t, s, "user"+string(rune('a'+i)))
	}
	done := make(chan error, 1)
	go func() {
		users, err := s.ListUsers()
		if err == nil && len(users) != 5 {
			err = &testLenError{got: len(users)}
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ListUsers failed: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListUsers deadlocked (rows held while querying roles)")
	}
}

type testLenError struct{ got int }

func (e *testLenError) Error() string { return "want 5 users, got " + itoa(e.got) }

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// TestUpdateSelfPassword 个人中心改展示名+改密，新密码可登录、旧密码失效。
func TestUpdateSelfPassword(t *testing.T) {
	s := newTestStore(t)
	u := reg(t, s, "alice")
	updated, err := s.UpdateSelf(u.ID, "Alice改", "newpass99")
	if err != nil {
		t.Fatal(err)
	}
	if updated.DisplayName != "Alice改" {
		t.Fatalf("displayName not updated: %s", updated.DisplayName)
	}
	if _, ok, _ := s.VerifyPassword("alice", "alicepass1"); ok {
		t.Fatal("old password still valid")
	}
	if _, ok, _ := s.VerifyPassword("alice", "newpass99"); !ok {
		t.Fatal("new password rejected")
	}
}

// TestCascadeDelete 外键级联：彻底删除任务后 claims/progress/deps/task_tags 无孤儿。
// 这是 v1「FK 声明未启用致孤儿」的回归护栏（OpenStore 已 PRAGMA foreign_keys=ON）。
func TestCascadeDelete(t *testing.T) {
	s := newTestStore(t)
	alice := reg(t, s, "alice")
	bob := reg(t, s, "bob")
	// 建两个任务并互设依赖、标签、认领、进度
	ts := time.Now().UTC().Format(time.RFC3339)
	t1 := Task{ID: newID(), Title: "t1", Content: "", Status: StatusTodo, Position: 1, CreatedAt: ts, UpdatedAt: ts}
	t2 := Task{ID: newID(), Title: "t2", Content: "", Status: StatusTodo, Position: 2, CreatedAt: ts, UpdatedAt: ts}
	if _, err := s.CreateTask(t1); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTask(t2); err != nil {
		t.Fatal(err)
	}
	if err := s.AddClaim(t1.ID, alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddClaim(t1.ID, bob.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddProgress(Progress{ID: newID(), TaskID: t1.ID, UserID: alice.ID, Percent: 30, Text: "x", CreatedAt: ts, UpdatedAt: ts}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddDep(t1.ID, t2.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.setTaskTags(nil, t1.ID, []string{"课设", "后端"}); err != nil {
		t.Fatal(err)
	}
	// 物理删除 t1
	if err := s.DeleteTask(t1.ID); err != nil {
		t.Fatal(err)
	}
	// 级联后子表应无 t1 引用
	for tbl, col := range map[string]string{
		"claims":     "task_id",
		"progress":   "task_id",
		"deps":       "task_id",
		"task_tags":  "task_id",
		"activities": "target_id",
	} {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM `+tbl+` WHERE `+col+`=?`, t1.ID).Scan(&n); err != nil && err != sql.ErrNoRows {
			t.Fatalf("query %s: %v", tbl, err)
		}
		// activities 无 FK（审计保留），允许残留；其余必须 0
		if tbl != "activities" && n != 0 {
			t.Fatalf("orphan rows in %s after cascade: %d", tbl, n)
		}
	}
}

// TestClaimUnique 认领唯一约束：同用户重复认领报错（DB 层 UNIQUE(task_id,user_id)）。
func TestClaimUnique(t *testing.T) {
	s := newTestStore(t)
	alice := reg(t, s, "alice")
	ts := time.Now().UTC().Format(time.RFC3339)
	t1 := Task{ID: newID(), Title: "t", Status: StatusTodo, Position: 1, CreatedAt: ts, UpdatedAt: ts}
	if _, err := s.CreateTask(t1); err != nil {
		t.Fatal(err)
	}
	if err := s.AddClaim(t1.ID, alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddClaim(t1.ID, alice.ID); err == nil {
		t.Fatal("duplicate claim should fail (UNIQUE)")
	}
}

// TestWouldCycle 依赖防成环：A->B 后 B->A 应检出环。
func TestWouldCycle(t *testing.T) {
	s := newTestStore(t)
	ts := time.Now().UTC().Format(time.RFC3339)
	mk := func(id string) Task { return Task{ID: id, Title: id, Status: StatusTodo, Position: 1, CreatedAt: ts, UpdatedAt: ts} }
	a, b, c := mk("a"), mk("b"), mk("c")
	for _, tsk := range []Task{a, b, c} {
		if _, err := s.CreateTask(tsk); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.AddDep("a", "b"); err != nil {
		t.Fatal(err)
	}
	if err := s.AddDep("b", "c"); err != nil {
		t.Fatal(err)
	}
	cycle, err := s.WouldCycle("c", "a") // c->a 会成环 a->b->c->a
	if err != nil {
		t.Fatal(err)
	}
	if !cycle {
		t.Fatal("expected cycle detected")
	}
	cycle, _ = s.WouldCycle("a", "c") // a->c 无环（a 已依赖 b，b 依赖 c，再加 a->c 是重复路径不构成环）
	if cycle {
		t.Fatal("a->c should not cycle")
	}
	cycle, _ = s.WouldCycle("a", "a")
	if !cycle {
		t.Fatal("self-dependency should cycle")
	}
}

// TestSoftDeleteTrash 软删→回收站→恢复→彻底删除 生命周期。
func TestSoftDeleteTrash(t *testing.T) {
	s := newTestStore(t)
	ts := time.Now().UTC().Format(time.RFC3339)
	t1 := Task{ID: newID(), Title: "t", Status: StatusTodo, Position: 1, CreatedAt: ts, UpdatedAt: ts}
	if _, err := s.CreateTask(t1); err != nil {
		t.Fatal(err)
	}
	if err := s.SoftDeleteTask(t1.ID); err != nil {
		t.Fatal(err)
	}
	// 列表不含，回收站含
	listed, err := s.ListTasks(false)
	if err != nil {
		t.Fatal(err)
	}
	for _, tk := range listed {
		if tk.ID == t1.ID {
			t.Fatal("soft-deleted task still in list")
		}
	}
	trash, err := s.ListTrash()
	if err != nil {
		t.Fatal(err)
	}
	if len(trash) != 1 || trash[0].ID != t1.ID {
		t.Fatalf("trash should contain task: %+v", trash)
	}
	if err := s.RestoreTask(t1.ID); err != nil {
		t.Fatal(err)
	}
	listed, _ = s.ListTasks(false)
	found := false
	for _, tk := range listed {
		if tk.ID == t1.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("restored task missing from list")
	}
	if err := s.DeleteTask(t1.ID); err != nil {
		t.Fatal(err)
	}
}
