package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newTestStore 每个测试独立库。
// 默认 SQLite 临时文件；设 KANB_TEST_DATABASE_URL 时改用 PostgreSQL
// （同一套 contract 测试在双库上跑，CI 的 postgres job 设该变量）。
func newTestStore(t *testing.T) *Store {
	t.Helper()
	var (
		s   *Store
		err error
	)
	if url := os.Getenv("KANB_TEST_DATABASE_URL"); url != "" {
		// PG：每测试一个独立 schema（连接池安全：DSN search_path 让每条连接自动指向该 schema）。
		schemaName := "t" + newID() // 纯数字 id 前加字母前缀
		admin, err2 := OpenPostgres(url)
		if err2 != nil {
				t.Fatal(err2)
		}
		// 用独立单连接建 schema（避免连接池 search_path 未生效的连接执行 DDL）
		conn, err2 := admin.db.Conn(context.Background())
		if err2 != nil {
			admin.Close()
			t.Fatal(err2)
		}
		if _, err2 := conn.ExecContext(context.Background(), `CREATE SCHEMA `+schemaName); err2 != nil {
			conn.Close()
			admin.Close()
			t.Fatal(err2)
		}
		conn.Close()
		admin.Close()
		// 正式 Store：DSN 带 search_path，所有连接自动落在该 schema
		sep := "?"
		if strings.Contains(url, "?") {
			sep = "&"
		}
		s, err = OpenPostgres(url + sep + "search_path=" + schemaName)
		t.Cleanup(func() {
			if s != nil {
				s.db.Exec(`DROP SCHEMA IF EXISTS ` + schemaName + ` CASCADE`)
				s.Close()
			}
		})
	} else {
		s, err = OpenStore(filepath.Join(t.TempDir(), "test.db"))
		t.Cleanup(func() { s.Close() })
	}
	if err != nil {
		t.Fatal(err)
	}
	s.Seed()
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
// 回归护栏：OpenStore 必须真正启用 PRAGMA foreign_keys=ON（声明不启用会留孤儿）。
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
	if err := s.setTaskTags(nil, t1.ID, []string{"测试", "后端"}); err != nil {
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
		if err := s.queryRow(s.db, `SELECT COUNT(*) FROM `+tbl+` WHERE `+col+`=?`, t1.ID).Scan(&n); err != nil && err != sql.ErrNoRows {
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

// TestStatsAggregation 统计聚合：跨表 GROUP BY/AVG 结果正确（状态分布/标签分布/
// 成员工作量/逾期数），软删与归档任务不污染统计。
func TestStatsAggregation(t *testing.T) {
	s := newTestStore(t)
	alice := reg(t, s, "alice")
	bob := reg(t, s, "bob")
	ts := time.Now().UTC().Format(time.RFC3339)
	mk := func(title, status string, tags []string, due string) *Task {
		tk := Task{ID: newID(), Title: title, Status: Status(status), Position: 1, DueDate: nil, Tags: tags, CreatedAt: ts, UpdatedAt: ts}
		if due != "" {
			tk.DueDate = &due
		}
		created, err := s.CreateTask(tk)
		if err != nil {
			t.Fatal(err)
		}
		return created
	}
	past := time.Now().UTC().AddDate(0, 0, -3).Format("2006-01-02")
	future := time.Now().UTC().AddDate(0, 0, 3).Format("2006-01-02")

	t1 := mk("任务A", "todo", []string{"后端"}, future)      // alice 创建
	t2 := mk("任务B", "in_progress", []string{"后端", "性能"}, "") // 逾期用
	t3 := mk("任务C", "done", []string{"前端"}, "")          // 无认领已完成

	// 认领与进度
	if err := s.AddClaim(t1.ID, alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddClaim(t2.ID, alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddClaim(t2.ID, bob.ID); err != nil {
		t.Fatal(err)
	}
	// 两个认领者对 t2 各自报进度 50 / 100
	for _, p := range []Progress{
		{ID: newID(), TaskID: t2.ID, UserID: alice.ID, Percent: 50, Text: "", CreatedAt: ts, UpdatedAt: ts},
		{ID: newID(), TaskID: t2.ID, UserID: bob.ID, Percent: 100, Text: "", CreatedAt: ts, UpdatedAt: ts},
	} {
		if err := s.AddProgress(p); err != nil {
			t.Fatal(err)
		}
	}
	// t2 无截止但设为进行中；造一条逾期：给 t1 改 past 截止
	if err := s.UpdateTask(Task{ID: t1.ID, Title: t1.Title, Status: StatusTodo, Position: 1, DueDate: &past, Archived: false, Tags: []string{"后端"}, UpdatedAt: ts}); err != nil {
		t.Fatal(err)
	}

	st, err := s.Stats()
	if err != nil {
		t.Fatal(err)
	}
	if st.TaskTotal != 3 || st.Todo != 1 || st.InProgress != 1 || st.Done != 1 {
		t.Fatalf("状态分布错误: %+v", st)
	}
	if st.Overdue != 1 {
		t.Fatalf("逾期计数错误: %d", st.Overdue)
	}
	// 平均进度 = (50+100)/2 = 75（认领者进度平均；无认领任务不计）
	if st.AvgTaskPct != 75 {
		t.Fatalf("avg pct = %v, want 75", st.AvgTaskPct)
	}
	// 成员工作量：alice 2 任务 (50+50)/2=50 因 t1 无进度只算 t2 的 50；bob 1 任务 100
	if len(st.ByMember) != 2 {
		t.Fatalf("成员数=%d, want 2: %+v", len(st.ByMember), st.ByMember)
	}
	for _, m := range st.ByMember {
		if m.UserName == "Alice" && (m.TaskCount != 2 || m.AvgPct != 50) {
			t.Fatalf("alice workload=%+v, want 2 tasks avg 50", m)
		}
		if m.UserName == "Bob" && (m.TaskCount != 1 || m.AvgPct != 100) {
			t.Fatalf("bob workload=%+v, want 1 task avg 100", m)
		}
	}
	// 标签分布：后端2、前端1、性能1
	tagByName := map[string]int{}
	for _, tg := range st.ByTag {
		tagByName[tg.Tag] = tg.Count
	}
	if tagByName["后端"] != 2 || tagByName["前端"] != 1 || tagByName["性能"] != 1 {
		t.Fatalf("标签分布错误: %+v", tagByName)
	}
	// 归档不污染统计
	t3.Archived = true
	if err := s.UpdateTask(Task{ID: t3.ID, Title: t3.Title, Status: StatusDone, Position: 1, Archived: true, UpdatedAt: ts}); err != nil {
		t.Fatal(err)
	}
	st2, _ := s.Stats()
	if st2.TaskTotal != 2 || st2.Archived != 1 {
		t.Fatalf("归档后统计错误: total=%d archived=%d", st2.TaskTotal, st2.Archived)
	}
}

// TestPasswordMinLength 密码强度契约：注册/改密密码少于 6 位被拒。
func TestPasswordMinLength(t *testing.T) {
	s := newTestStore(t)
	if _, _, err := s.Register("short", "123", "短"); err == nil {
		t.Fatal("注册短密码应被拒")
	}
	u := reg(t, s, "alice") // alice 密码 alicepass1
	if _, err := s.UpdateSelf(u.ID, "Alice", "123"); err == nil {
		t.Fatal("改密短密码应被拒")
	}
	if _, err := s.UpdateSelf(u.ID, "Alice", "abcdef"); err != nil {
		t.Fatalf("改密 ≥6 位应通过: %v", err)
	}
}

// TestCommentLifecycle 评论：发表顶层+回复 → 归属校验 → 删父级联回复 → 删任务级联清评论。
func TestCommentLifecycle(t *testing.T) {
	s := newTestStore(t)
	alice := reg(t, s, "alice")
	bob := reg(t, s, "bob")
	ts := time.Now().UTC().Format(time.RFC3339)
	t1 := Task{ID: newID(), Title: "t1", Content: "", Status: StatusTodo, Position: 1, CreatedAt: ts, UpdatedAt: ts}
	if _, err := s.CreateTask(t1); err != nil {
		t.Fatal(err)
	}
	add := func(userID, parentID, content string) *Comment {
		t.Helper()
		c := Comment{ID: newID(), TaskID: t1.ID, UserID: userID, ParentID: parentID, Content: content, CreatedAt: ts, UpdatedAt: ts}
		if err := s.AddComment(c); err != nil {
			t.Fatalf("AddComment: %v", err)
		}
		return &c
	}
	top := add(alice.ID, "", "这个任务先做前置调研")
	reply := add(bob.ID, top.ID, "我来补充背景资料")
	_ = add(alice.ID, "", "记得同步到文档")

	// 读取：按时间正序，含 author 展示名
	all, err := s.ListComments(t1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("want 3 comments, got %d", len(all))
	}
	if all[0].Author != "展示alice" || all[1].Author != "展示bob" {
		t.Fatalf("author mismatch: %+v", all)
	}
	if all[1].ParentID != top.ID {
		t.Fatalf("reply parent wrong: %q", all[1].ParentID)
	}

	// 归属：GetComment 带作者
	got, err := s.GetComment(top.ID)
	if err != nil || got == nil {
		t.Fatalf("GetComment: %v %v", got, err)
	}
	if got.UserID != alice.ID || got.Content != "这个任务先做前置调研" {
		t.Fatalf("comment fields wrong: %+v", got)
	}

	// 编辑
	if err := s.UpdateComment(reply.ID, "已补充完毕", ts); err != nil {
		t.Fatal(err)
	}
	gotReply, _ := s.GetComment(reply.ID)
	if gotReply.Content != "已补充完毕" {
		t.Fatalf("update failed: %+v", gotReply)
	}

	// 删除父评论 → 回复级联消失（外键 ON DELETE CASCADE）
	if err := s.DeleteComment(top.ID); err != nil {
		t.Fatal(err)
	}
	left, _ := s.ListComments(t1.ID)
	if len(left) != 1 {
		t.Fatalf("after delete parent want 1, got %d", len(left))
	}

	// 删任务 → 评论全清
	if err := s.DeleteTask(t1.ID); err != nil {
		t.Fatal(err)
	}
	left, _ = s.ListComments(t1.ID)
	if len(left) != 0 {
		t.Fatalf("after task delete want 0, got %d", len(left))
	}
}
