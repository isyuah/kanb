// Command migrate-legacy 把旧版 kanb（免登录、X-Author 人名模型）的 SQLite 库
// 迁移为新版（账号/RBAC）库。
//
// 用法（在 server/ 目录）：
//
//	go build -o migrate-legacy.exe ./migrate-legacy
//	migrate-legacy.exe -old <legacy.db> -new <new.db> [-out creds.txt] [-force]
//
// 映射规则：
//   - 真人（现存任务上的认领/进度作者，除工具名单）→ 各建一个账号：
//     username = display_name = 原名，随机密码；-admin 指定的人为 admin，其余 member。
//   - 工具名不建账号：cutoff 后残余活动 user_id=NULL（UI 显示「已注销」），
//     用户管理列表保持干净（只含真人）。
//   - demoCutoff（2026-09-03T15:58:00Z）前的示例/测试活动整体丢弃，
//     不重建已物理删除的 seed 任务，示例人物（陈默/林晚/周舟）不建账号。
//   - 任务/认领/进度/活动保留原主键与时间戳；任务 position 按状态列规范化为 1..N。
//   - 标签 JSON 列拆为 tags + task_tags 关联表。
//   - 旧库外键未启用遗留的孤儿 claims/progress/deps（指向已物理删除的任务）不迁移。
//   - activities 迁移 cutoff 后的真实部分（新版 activities 不引用 tasks，
//     已删任务的早期活动已随 demo 清理丢弃）。
//
// schema 常量须与 server/store.go 保持一致（测试会以新版 server 打开迁移库验证）。
package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

// schema 与新版 server/store.go 的 schema 常量逐字一致（12 表，3NF）。
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id)  ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tags (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
  position   REAL NOT NULL DEFAULT 0,
  due_date   TEXT,
  archived   INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_archived  ON tasks(archived);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted   ON tasks(deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_createdby ON tasks(created_by);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);

CREATE TABLE IF NOT EXISTS claims (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_user ON claims(user_id);

CREATE TABLE IF NOT EXISTS progress (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  percent    INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  text       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);

CREATE TABLE IF NOT EXISTS deps (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  dep_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, dep_id),
  CHECK (task_id <> dep_id)
);

CREATE TABLE IF NOT EXISTS activities (
  id         TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  task_title TEXT NOT NULL DEFAULT '',
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
`

// 真人账号 = 现存任务上的认领人/进度作者（排除工具名单）。
// 工具名（种子脚本/AI助手/test/清理/恢复/小明/isyuah/匿名）不建账号：
// 其 cutoff 后残余活动以 user_id=NULL（已注销）承接，不污染用户管理列表。
var toolNames = map[string]bool{
	"种子脚本": true,
	"AI助手":  true,
	"test":   true,
	"清理":   true,
	"恢复":   true,
	"匿名":   true,
	"小明":   true,
	"isyuah": true,
}

const (
	// demoCutoff 示例/测试活动分界（UTC）：此前为 seed-demo + 手工测试产生的
	// 演示数据（对象均为已物理删除的示例任务），此后才是真实任务
	// （2026-09-03 15:58 起由郭家豪批量导入）。迁移丢弃此前的 activities。
	demoCutoff = "2026-09-03T15:58:00Z"
)

type userCred struct {
	Username    string
	Password    string // 仅脚本进程内明文；库中存 bcrypt
	DisplayName string
	Role        string
}

func nowStr() string { return time.Now().UTC().Format(time.RFC3339) }

func randomPassword() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("生成随机密码失败: %v", err)
	}
	return hex.EncodeToString(b)
}

func hashPassword(pw string) string {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("bcrypt 失败: %v", err)
	}
	return string(h)
}

// ---- 主键生成（与新版 store.go newID 同构：纳秒时间戳 + 进程内原子序号）----

var idSeq = uint64(time.Now().UnixNano() & 0xFFFF)
var idMu sync.Mutex

func newID() string {
	idMu.Lock()
	idSeq++
	n := idSeq
	idMu.Unlock()
	return fmt.Sprintf("%d%d", time.Now().UnixNano(), n%1000000)
}

// ---- 旧库读取 ----

type oldTask struct {
	ID, Title, Content, Status string
	Position                   float64
	DueDate                    sql.NullString
	Tags                       string
	Archived                   int
	CreatedAt, UpdatedAt       string
}

type oldClaim struct {
	ID, TaskID, Claimer, CreatedAt string
}

type oldProgress struct {
	ID, TaskID, Author, CreatedAt, UpdatedAt string
	Percent                                   int
	Text                                      string
}

type oldDep struct {
	TaskID, DepID, CreatedAt string
}

type oldActivity struct {
	ID, Action, Target, TargetID, TaskTitle, Author, CreatedAt string
}

func openOld(path string) *sql.DB {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		log.Fatalf("打开旧库失败: %v", err)
	}
	if err := db.Ping(); err != nil {
		log.Fatalf("旧库不可读: %v", err)
	}
	return db
}

func openNew(path string) *sql.DB {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	if err != nil {
		log.Fatalf("打开新库失败: %v", err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		log.Fatalf("建新库 schema 失败: %v", err)
	}
	return db
}

func main() {
	oldPath := flag.String("old", "", "旧版 SQLite 库路径（必填）")
	newPath := flag.String("new", "kanb-migrated.db", "新版库输出路径")
	adminName := flag.String("admin", "郭家豪", "设为 admin 的历史真人名")
	outPath := flag.String("out", "", "凭据输出文件（缺省打 stdout）")
	force := flag.Bool("force", false, "覆盖已存在的 -new 文件")
	flag.Parse()

	if *oldPath == "" {
		log.Fatal("缺少 -old")
	}
	if _, err := os.Stat(*oldPath); err != nil {
		log.Fatalf("旧库不存在: %v", err)
	}
	if _, err := os.Stat(*newPath); err == nil && !*force {
		log.Fatalf("目标库已存在（用 -force 覆盖）: %s", *newPath)
	} else if err == nil && *force {
		if err := os.Remove(*newPath); err != nil {
			log.Fatalf("删除旧目标库失败: %v", err)
		}
	}

	old := openOld(*oldPath)
	defer old.Close()
	if dir := filepath.Dir(*newPath); dir != "" && dir != "." {
		_ = os.MkdirAll(dir, 0o755)
	}
	nw := openNew(*newPath)
	defer nw.Close()

	// 真人账号 = 现存任务上的认领人/进度作者（排除工具名）。
	// 注意：不用活动作者全集——示例人物（陈默/林晚/周舟）只在已删的 seed 任务上
	// 留过认领/进度/活动，不计为账号；其认领/进度随孤儿关系一并丢弃。
	nameSet := map[string]bool{}
	collect := func(q string) {
		rows, err := old.Query(q)
		if err != nil {
			log.Fatalf("收集姓名失败 %s: %v", q, err)
		}
		defer rows.Close()
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				continue
			}
			if strings.TrimSpace(n) != "" {
				nameSet[n] = true
			}
		}
	}
	collect(`SELECT DISTINCT c.claimer FROM claims c JOIN tasks t ON t.id=c.task_id`)
	collect(`SELECT DISTINCT p.author FROM progress p JOIN tasks t ON t.id=p.task_id`)

	var realNames []string
	for n := range nameSet {
		if !toolNames[n] {
			realNames = append(realNames, n)
		}
	}
	sort.Strings(realNames)
	if len(realNames) == 0 {
		log.Fatal("没有可迁移的真人账号")
	}
	// admin 必须存在于真人名单
	adminOK := false
	for _, n := range realNames {
		if n == *adminName {
			adminOK = true
		}
	}
	if !adminOK {
		log.Fatalf("-admin %q 不在真人名单里: %v", *adminName, realNames)
	}

	// 建用户（事务）
	tx, err := nw.Begin()
	if err != nil {
		log.Fatalf("开启事务失败: %v", err)
	}
	defer tx.Rollback()

	roleID := map[string]string{}
	for _, code := range []string{"admin", "member", "viewer"} {
		rid := newID()
		if _, err := tx.Exec(`INSERT INTO roles (id,code,description) VALUES (?,?,?)`, rid, code, ""); err != nil {
			log.Fatalf("插入角色失败: %v", err)
		}
		roleID[code] = rid
	}

	var creds []userCred
	userIDByName := map[string]string{}
	mkUser := func(username, password, displayName, role string) string {
		uid := newID()
		if _, err := tx.Exec(`INSERT INTO users (id,username,password_hash,display_name,disabled,created_at) VALUES (?,?,?,?,0,?)`,
			uid, username, hashPassword(password), displayName, nowStr()); err != nil {
			log.Fatalf("插入用户 %s 失败: %v", username, err)
		}
		if _, err := tx.Exec(`INSERT INTO user_roles (user_id,role_id) VALUES (?,?)`, uid, roleID[role]); err != nil {
			log.Fatalf("分配角色失败: %v", err)
		}
		userIDByName[displayName] = uid
		creds = append(creds, userCred{username, password, displayName, role})
		return uid
	}

	for _, name := range realNames {
		pw := randomPassword()
		role := "member"
		if name == *adminName {
			role = "admin"
		}
		mkUser(name, pw, name, role)
	}

	// ---- 任务 ----
	rows, err := old.Query(`SELECT id,title,content,status,position,due_date,tags,archived,created_at,updated_at FROM tasks ORDER BY status, position, created_at`)
	if err != nil {
		log.Fatalf("读任务失败: %v", err)
	}
	var tasks []oldTask
	for rows.Next() {
		var t oldTask
		if err := rows.Scan(&t.ID, &t.Title, &t.Content, &t.Status, &t.Position, &t.DueDate, &t.Tags, &t.Archived, &t.CreatedAt, &t.UpdatedAt); err != nil {
			log.Fatalf("扫任务失败: %v", err)
		}
		tasks = append(tasks, t)
	}
	rows.Close()

	// 标签：全任务 tags 并集（拆 JSON）
	tagIDByName := map[string]string{}
	var tagNames []string
	for _, t := range tasks {
		var names []string
		if err := json.Unmarshal([]byte(t.Tags), &names); err == nil {
			for _, n := range names {
				n = strings.TrimSpace(n)
				if n != "" && tagIDByName[n] == "" {
					tagIDByName[n] = newID()
					tagNames = append(tagNames, n)
				}
			}
		}
	}
	sort.Strings(tagNames)
	for _, n := range tagNames {
		if _, err := tx.Exec(`INSERT INTO tags (id,name) VALUES (?,?)`, tagIDByName[n], n); err != nil {
			log.Fatalf("插入标签失败: %v", err)
		}
	}

	// 状态列 position 规范化 1..N（修复旧库 done 列 2.0 重复等）
	posByStatus := map[string]int{}
	adminUID := userIDByName[*adminName]
	insertedTasks := 0
	for _, t := range tasks {
		posByStatus[t.Status]++
		pos := posByStatus[t.Status]
		var due any
		if t.DueDate.Valid {
			due = t.DueDate.String
		}
		// 删除/归档标志旧库无删除记录（deleted_at 全 NULL；archived 全 0）
		if _, err := tx.Exec(`INSERT INTO tasks (id,title,content,status,position,due_date,archived,deleted_at,created_by,created_at,updated_at)
			VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
			t.ID, t.Title, t.Content, t.Status, pos, due, t.Archived, adminUID, t.CreatedAt, t.UpdatedAt); err != nil {
			log.Fatalf("插入任务失败 %s: %v", t.ID, err)
		}
		// task_tags
		var names []string
		if err := json.Unmarshal([]byte(t.Tags), &names); err == nil {
			seen := map[string]bool{}
			for _, n := range names {
				n = strings.TrimSpace(n)
				if n == "" || seen[n] {
					continue
				}
				seen[n] = true
				if _, err := tx.Exec(`INSERT INTO task_tags (task_id,tag_id) VALUES (?,?)`, t.ID, tagIDByName[n]); err != nil {
					log.Fatalf("插入 task_tags 失败: %v", err)
				}
			}
		}
		insertedTasks++
	}

	liveTask := func(id string) bool {
		for _, t := range tasks {
			if t.ID == id {
				return true
			}
		}
		return false
	}
	// uidFor：真人名 → 账号 id；工具名/未知 → ""（落库为 NULL=已注销）。
	uidOrBot := func(name string) string {
		if id := userIDByName[name]; id != "" {
			return id
		}
		return ""
	}

	// ---- claims（丢弃孤儿）----
	rows, err = old.Query(`SELECT id,task_id,claimer,created_at FROM claims`)
	if err != nil {
		log.Fatalf("读认领失败: %v", err)
	}
	var droppedClaims, keptClaims int
	for rows.Next() {
		var c oldClaim
		if err := rows.Scan(&c.ID, &c.TaskID, &c.Claimer, &c.CreatedAt); err != nil {
			log.Fatalf("扫认领失败: %v", err)
		}
		if !liveTask(c.TaskID) {
			droppedClaims++
			continue
		}
		if _, err := tx.Exec(`INSERT INTO claims (id,task_id,user_id,created_at) VALUES (?,?,?,?)`,
			c.ID, c.TaskID, uidOrBot(c.Claimer), c.CreatedAt); err != nil {
			log.Fatalf("插入认领失败: %v", err)
		}
		keptClaims++
	}
	rows.Close()

	// ---- progress（丢弃孤儿）----
	rows, err = old.Query(`SELECT id,task_id,author,percent,text,created_at,updated_at FROM progress`)
	if err != nil {
		log.Fatalf("读进度失败: %v", err)
	}
	// 快照索引：progress 的 created_at/updated_at 与对应 activity 同秒（同 now()），
	// 供活动 detail 回填（percent/text 是现值；行未被后续改/删时即原始值）。
	progByCreated := map[string]oldProgress{}
	progByUpdated := map[string]oldProgress{}
	var droppedProg, keptProg int
	for rows.Next() {
		var p oldProgress
		if err := rows.Scan(&p.ID, &p.TaskID, &p.Author, &p.Percent, &p.Text, &p.CreatedAt, &p.UpdatedAt); err != nil {
			log.Fatalf("扫进度失败: %v", err)
		}
		progByCreated[p.CreatedAt] = p
		progByUpdated[p.UpdatedAt] = p
		if !liveTask(p.TaskID) {
			droppedProg++
			continue
		}
		if _, err := tx.Exec(`INSERT INTO progress (id,task_id,user_id,percent,text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
			p.ID, p.TaskID, uidOrBot(p.Author), p.Percent, p.Text, p.CreatedAt, p.UpdatedAt); err != nil {
			log.Fatalf("插入进度失败: %v", err)
		}
		keptProg++
	}
	rows.Close()

	// 进度 detail 回填：activity.created_at 与某 progress.created_at/updated_at 同秒
	// → 记 {p,text,id}；否则 nil。
	backfillProgress := func(a oldActivity) string {
		if p, ok := progByCreated[a.CreatedAt]; ok {
			b, _ := json.Marshal(map[string]any{"p": p.Percent, "text": p.Text, "id": p.ID})
			return string(b)
		}
		if p, ok := progByUpdated[a.CreatedAt]; ok {
			b, _ := json.Marshal(map[string]any{"p": p.Percent, "text": p.Text, "id": p.ID})
			return string(b)
		}
		return ""
	}

	// ---- deps（丢弃指向已删任务的）----
	rows, err = old.Query(`SELECT task_id,dep_id,created_at FROM deps`)
	if err != nil {
		log.Fatalf("读依赖失败: %v", err)
	}
	var droppedDeps, keptDeps int
	depByTime := map[string]oldDep{}
	for rows.Next() {
		var d oldDep
		if err := rows.Scan(&d.TaskID, &d.DepID, &d.CreatedAt); err != nil {
			log.Fatalf("扫依赖失败: %v", err)
		}
		depByTime[d.CreatedAt] = d
		if !liveTask(d.TaskID) || !liveTask(d.DepID) {
			droppedDeps++
			continue
		}
		if _, err := tx.Exec(`INSERT INTO deps (task_id,dep_id,created_at) VALUES (?,?,?)`,
			d.TaskID, d.DepID, d.CreatedAt); err != nil {
			log.Fatalf("插入依赖失败: %v", err)
		}
		keptDeps++
	}
	rows.Close()

	// ---- activities（只迁移 demoCutoff 后的真实活动；真人名→账号，工具名→NULL）----
	rows, err = old.Query(`SELECT id,action,target,target_id,task_title,author,created_at FROM activities`)
	if err != nil {
		log.Fatalf("读活动失败: %v", err)
	}
	var keptActs, demoActs int
	for rows.Next() {
		var a oldActivity
		if err := rows.Scan(&a.ID, &a.Action, &a.Target, &a.TargetID, &a.TaskTitle, &a.Author, &a.CreatedAt); err != nil {
			log.Fatalf("扫活动失败: %v", err)
		}
		if a.CreatedAt < demoCutoff {
			demoActs++
			continue
		}
		uid := uidOrBot(a.Author)
		var uidArg any
		if uid != "" {
			uidArg = uid
		}
		// detail 回填：progress/progress_updated → 同秒进度快照；dep_added/removed → {dep}
		var detail any
		switch a.Action {
		case "progress", "progress_updated":
			if s := backfillProgress(a); s != "" {
				detail = s
			}
		case "dep_added", "dep_removed":
			if d, ok := depByTime[a.CreatedAt]; ok {
				b, _ := json.Marshal(map[string]string{"dep": d.DepID})
				detail = string(b)
			}
		}
		if _, err := tx.Exec(`INSERT INTO activities (id,action,target,target_id,task_title,user_id,detail,created_at) VALUES (?,?,?,?,?,?,?,?)`,
			a.ID, a.Action, a.Target, a.TargetID, a.TaskTitle, uidArg, detail, a.CreatedAt); err != nil {
			log.Fatalf("插入活动失败: %v", err)
		}
		keptActs++
	}
	rows.Close()

	if err := tx.Commit(); err != nil {
		log.Fatalf("提交失败: %v", err)
	}

	// ---- 汇报 ----
	var out *os.File = os.Stdout
	if *outPath != "" {
		f, err := os.Create(*outPath)
		if err != nil {
			log.Fatalf("创建凭据文件失败: %v", err)
		}
		out = f
		defer out.Close()
	}
	fmt.Fprintf(out, "# kanb 迁移账号（新库首次登录后请立即改密）\n")
	for _, c := range creds {
		fmt.Fprintf(out, "%s\t%s\t%s\t%s\n", c.Username, c.Password, c.DisplayName, c.Role)
	}
	fmt.Fprintf(out, "# 注：%d 条示例/测试活动（%s 前）已按数据清理丢弃\n", demoActs, demoCutoff)

	log.Printf("迁移完成: 账号 %d", len(creds))
	log.Printf("任务 %d · 认领 %d（丢弃孤儿 %d）· 进度 %d（丢弃孤儿 %d）· 依赖 %d（丢弃孤儿 %d）· 活动 %d（丢弃示例 %d）",
		insertedTasks, keptClaims, droppedClaims, keptProg, droppedProg, keptDeps, droppedDeps, keptActs, demoActs)
}
