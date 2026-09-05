package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jmoiron/sqlx"
	_ "github.com/jackc/pgx/v5/stdlib" // 注册 "pgx" 驱动
	_ "modernc.org/sqlite"
)

// schema 为全量库表定义：users/roles/user_roles/sessions/tags/task_tags/
// tasks/claims/progress/deps/activities/settings 共 12 表，满足 3NF，见 docs/db-design.md。
// 注意：SQLite 不支持修改列，本 schema 只在全新库上执行（历史数据迁移需另做，见 docs）。
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,              -- 纳秒时间戳字符串主键
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,            -- admin | member | viewer
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
  due_date   TEXT,                             -- YYYY-MM-DD
  archived   INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,                             -- 软删标记；NULL=未删除（回收站列表 = deleted_at 非空）
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
  CHECK (task_id <> dep_id)                    -- 禁止自依赖
);

CREATE TABLE IF NOT EXISTS activities (
  id         TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  task_title TEXT NOT NULL DEFAULT '',         -- 审计快照（3NF 论证见 docs/db-design.md §4.4）
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL, -- NULL=匿名/已注销
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL, -- NULL=匿名/已注销
  parent_id  TEXT REFERENCES comments(id) ON DELETE CASCADE, -- NULL=顶层评论
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

// 公开度模式默认值（settings 表无记录时生效，注册时也写入）。
const defaultPublicMode = ModePrivate

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// newID 生成全局唯一主键：纳秒时间戳 + 进程内原子序号。
// 仅用 UnixNano 在 Windows 等时钟粒度较粗的平台、同毫秒内快速连续插入时
// 会撞主键（曾导致创建任务/注册报「多次冲突」），加原子序号保证进程内唯一；
// 序号以随机数起步，降低多进程（多实例）同纳秒碰撞概率。
var idSeq = uint64(time.Now().UnixNano() & 0xFFFF)
var idMu sync.Mutex

func newID() string {
	idMu.Lock()
	idSeq++
	n := idSeq
	idMu.Unlock()
	return fmt.Sprintf("%d%d", time.Now().UnixNano(), n%1000000)
}

// DBKind 标识底层数据库方言。SQLite 与 PostgreSQL 的 SQL 共享
// （? 占位符统一书写，执行时经 bind 翻译），仅少数点分叉。
type DBKind uint8

const (
	KindSQLite DBKind = iota
	KindPostgres
)

type Store struct {
	db   *sql.DB
	kind DBKind
}

// OpenSQLite 打开 SQLite 文件库。外键经 DSN _pragma 在每个连接初始化时自动启用
// （PRAGMA 为连接级设置，Exec 一次只作用于单条连接，放 DSN 才真正可靠）。
func OpenSQLite(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // serialize writes; sqlite file lock simplicity
	db.SetMaxIdleConns(1)
	return openStore(db, KindSQLite)
}

// OpenPostgres 连接远程 PostgreSQL。连接池大小属部署配置而非方言规定，
// 默认 5/2，可用 KANB_PG_MAX_OPEN / KANB_PG_MAX_IDLE 覆盖。
func OpenPostgres(dsn string) (*Store, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	maxOpen := envInt("KANB_PG_MAX_OPEN", 5)
	maxIdle := envInt("KANB_PG_MAX_IDLE", 2)
	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	return openStore(db, KindPostgres)
}

func openStore(db *sql.DB, kind DBKind) (*Store, error) {
	s := &Store{db: db, kind: kind}
	if _, err := db.Exec(s.bind(schema)); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// OpenStore 兼容入口：SQLite 文件路径（原签名，main/测试沿用）。
func OpenStore(path string) (*Store, error) {
	return OpenSQLite(path)
}

func (s *Store) Close() error { return s.db.Close() }

// ---- 方言适配 ----

// bind 把统一书写的 ? 占位符翻译为当前方言（PG → $1/$2…；SQLite 原样）。
func (s *Store) bind(q string) string {
	if s.kind == KindPostgres {
		return sqlx.Rebind(sqlx.DOLLAR, q)
	}
	return q
}

// dbx 覆盖 *sql.DB 与 *sql.Tx 的查询接口，使 exec/query/queryRow 可统一收口。
type dbx interface {
	Exec(string, ...any) (sql.Result, error)
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

func (s *Store) exec(x dbx, q string, args ...any) (sql.Result, error) {
	if isNilDBX(x) {
		x = s.db
	}
	return x.Exec(s.bind(q), args...)
}
func (s *Store) query(x dbx, q string, args ...any) (*sql.Rows, error) {
	if isNilDBX(x) {
		x = s.db
	}
	return x.Query(s.bind(q), args...)
}
func (s *Store) queryRow(x dbx, q string, args ...any) *sql.Row {
	if isNilDBX(x) {
		x = s.db
	}
	return x.QueryRow(s.bind(q), args...)
}

// isNilDBX 识别「类型化 nil 指针装入 interface」的经典陷阱
// （nil *sql.Tx 赋给 dbx 后 x != nil，直接调用会 nil 解引用）。
func isNilDBX(x dbx) bool {
	if x == nil {
		return true
	}
	switch v := x.(type) {
	case *sql.DB:
		return v == nil
	case *sql.Tx:
		return v == nil
	}
	return false
}

// isUniqueViolation 识别唯一/主键冲突（按方言错误类型；errors.As 兼容 %w 包裹）。
func (s *Store) isUniqueViolation(err error) bool {
	switch s.kind {
	case KindSQLite:
		var ce interface{ Code() int }
		if errors.As(err, &ce) {
			switch ce.Code() {
			case 1555, 2067: // SQLITE_CONSTRAINT_PRIMARYKEY / SQLITE_CONSTRAINT_UNIQUE
				return true
			}
		}
		return false
	case KindPostgres:
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			return pgErr.Code == "23505"
		}
		return false
	}
	return false
}

func idsAny(ids []string) []any {
	out := make([]any, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

func (s *Store) queryTasks(where string, args ...any) ([]Task, error) {
	q := `SELECT t.id,t.title,t.content,t.status,t.position,t.due_date,t.archived,t.deleted_at,
        COALESCE(t.created_by,''),COALESCE(u.display_name,''),
        t.created_at,t.updated_at
        FROM tasks t
        LEFT JOIN users u ON u.id = t.created_by`
	if where != "" {
		q += ` WHERE ` + where
	}
	q += ` ORDER BY t.position ASC, t.created_at ASC`
	rows, err := s.query(s.db, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := []Task{}
	for rows.Next() {
		var t Task
		var archived int
		var deletedAt sql.NullString
		var createdBy, createdByName string
		if err := rows.Scan(&t.ID, &t.Title, &t.Content, &t.Status, &t.Position, &t.DueDate,
			&archived, &deletedAt, &createdBy, &createdByName, &t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		t.Archived = archived != 0
		if deletedAt.Valid {
			t.DeletedAt = deletedAt.String
		}
		if createdBy != "" {
			t.CreatedBy = createdBy
		}
		if createdByName != "" {
			t.CreatedByName = createdByName
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

// taskTagMap returns taskID -> []tag name for all tasks whose id is in ids.
func (s *Store) taskTagMap(ids []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(ids) == 0 {
		return out, nil
	}
	in := strings.Repeat("?,", len(ids))
	in = in[:len(in)-1]
	rows, err := s.query(s.db, `SELECT tt.task_id, tg.name FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id IN (`+in+`) ORDER BY tg.name`, idsAny(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var taskID, name string
		if err := rows.Scan(&taskID, &name); err != nil {
			return nil, err
		}
		out[taskID] = append(out[taskID], name)
	}
	return out, rows.Err()
}

// loadRelations attaches tags/claims/progress/deps to a task set in one pass.
func (s *Store) loadRelations(tasks []Task) ([]Task, error) {
	if len(tasks) == 0 {
		return tasks, nil
	}
	ids := make([]string, len(tasks))
	for i, t := range tasks {
		ids[i] = t.ID
	}
	in := strings.Repeat("?,", len(ids))
	in = in[:len(in)-1]
	anyIDs := idsAny(ids)

	// 标签一次性 join 关联（task_tags + tags）
	tagMap, err := s.taskTagMap(ids)
	if err != nil {
		return nil, err
	}

	claims := map[string][]Claim{}
	rows, err := s.query(s.db, `SELECT c.id,c.task_id,c.user_id,u.display_name,c.created_at
        FROM claims c JOIN users u ON u.id=c.user_id
        WHERE c.task_id IN (`+in+`) ORDER BY c.created_at, c.id`, anyIDs...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var c Claim
		if err := rows.Scan(&c.ID, &c.TaskID, &c.UserID, &c.Claimer, &c.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		claims[c.TaskID] = append(claims[c.TaskID], c)
	}
	rows.Close()

	progs := map[string][]Progress{}
	rows, err = s.query(s.db, `SELECT p.id,p.task_id,p.user_id,u.display_name,p.percent,p.text,p.created_at,p.updated_at
        FROM progress p JOIN users u ON u.id=p.user_id
        WHERE p.task_id IN (`+in+`) ORDER BY p.created_at DESC`, anyIDs...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p Progress
		if err := rows.Scan(&p.ID, &p.TaskID, &p.UserID, &p.Author, &p.Percent, &p.Text, &p.CreatedAt, &p.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		progs[p.TaskID] = append(progs[p.TaskID], p)
	}
	rows.Close()

	deps := map[string][]Dep{}
	rows, err = s.query(s.db, `SELECT d.task_id,d.dep_id,t.title,t.status,t.archived
        FROM deps d JOIN tasks t ON t.id=d.dep_id
        WHERE d.task_id IN (`+in+`) ORDER BY d.created_at`, anyIDs...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d Dep
		if err := rows.Scan(&d.TaskID, &d.DepID, &d.Title, &d.Status, &d.Archived); err != nil {
			rows.Close()
			return nil, err
		}
		deps[d.TaskID] = append(deps[d.TaskID], d)
	}
	rows.Close()

	for i := range tasks {
		if tags := tagMap[tasks[i].ID]; tags != nil {
			tasks[i].Tags = tags
		} else {
			tasks[i].Tags = []string{}
		}
		tasks[i].Claims = claims[tasks[i].ID]
		tasks[i].Progress = progs[tasks[i].ID]
		tasks[i].Deps = deps[tasks[i].ID]
		if tasks[i].Claims == nil {
			tasks[i].Claims = []Claim{}
		}
		if tasks[i].Progress == nil {
			tasks[i].Progress = []Progress{}
		}
		if tasks[i].Deps == nil {
			tasks[i].Deps = []Dep{}
		}
	}
	return tasks, nil
}

// ListTasks 列表：默认不含软删（deleted_at IS NULL）；includeArchived 控制是否含已归档。
func (s *Store) ListTasks(includeArchived bool) ([]Task, error) {
	where := "t.deleted_at IS NULL AND t.archived=0"
	if includeArchived {
		where = "t.deleted_at IS NULL"
	}
	tasks, err := s.queryTasks(where)
	if err != nil {
		return nil, err
	}
	return s.loadRelations(tasks)
}

// ListTrash 回收站：软删任务（含关系）。
func (s *Store) ListTrash() ([]Task, error) {
	tasks, err := s.queryTasks(`t.deleted_at IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	return s.loadRelations(tasks)
}

func (s *Store) GetTask(id string) (*Task, error) {
	tasks, err := s.queryTasks("t.id=?", id)
	if err != nil || len(tasks) == 0 {
		return nil, err
	}
	loaded, err := s.loadRelations(tasks)
	if err != nil {
		return nil, err
	}
	return &loaded[0], nil
}

// GetTrashTask 按 id 取回收站中的任务（deleted_at 非空），找不到返回 nil。
func (s *Store) GetTrashTask(id string) (*Task, error) {
	tasks, err := s.queryTasks(`t.id=? AND t.deleted_at IS NOT NULL`, id)
	if err != nil || len(tasks) == 0 {
		return nil, err
	}
	loaded, err := s.loadRelations(tasks)
	if err != nil {
		return nil, err
	}
	return &loaded[0], nil
}

// resolveTags 按名字查找或创建标签，返回 tag_id 列表（顺序与输入一致，重复名合并）。
func (s *Store) resolveTags(tx *sql.Tx, names []string) ([]string, error) {
	ids := make([]string, 0, len(names))
	seen := map[string]bool{}
	for _, n := range names {
		name := strings.TrimSpace(n)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		// 标签已存在则直接命中；否则新建。
		var id string
		var qerr error
		if tx != nil {
			qerr = s.queryRow(tx, `SELECT id FROM tags WHERE name=?`, name).Scan(&id)
		} else {
			qerr = s.queryRow(s.db, `SELECT id FROM tags WHERE name=?`, name).Scan(&id)
		}
		if qerr == nil {
			ids = append(ids, id)
			continue
		}
		if qerr != sql.ErrNoRows {
			return nil, qerr
		}
		// 新建：id 用 newID()（UnixNano）。同一次调用内多个标签可能撞同一纳秒值，
		// 生成冲突时重试（不能靠 INSERT OR IGNORE 掩盖——它会把主键冲突吞掉，
		// 随后的 SELECT 仍查不到该名字的标签，造成 "no rows"）。
		var inserted bool
		for range 5 {
			if _, err := s.exec(tx, `INSERT INTO tags (id,name) VALUES (?,?)`, newID(), name); err != nil {
				if !s.isUniqueViolation(err) {
					return nil, err
				}
				continue // 主键撞纳秒值，换 id 重试
			}
			inserted = true
			break
		}
		if !inserted {
			return nil, fmt.Errorf("生成标签 id 失败（多次冲突）")
		}
		// 拿到刚插入的 id：TEXT 主键无法用 LastInsertId，按名字再查一次。
		if tx != nil {
			qerr = s.queryRow(tx, `SELECT id FROM tags WHERE name=?`, name).Scan(&id)
		} else {
			qerr = s.queryRow(s.db, `SELECT id FROM tags WHERE name=?`, name).Scan(&id)
		}
		if qerr != nil {
			return nil, qerr
		}
		ids = append(ids, id)
	}
	return ids, nil
}

// setTaskTags 整体替换任务标签（事务内可传 tx）。
func (s *Store) setTaskTags(tx *sql.Tx, taskID string, names []string) error {
	if _, err := s.exec(tx, `DELETE FROM task_tags WHERE task_id=?`, taskID); err != nil {
		return err
	}
	ids, err := s.resolveTags(tx, names)
	if err != nil {
		return err
	}
	for _, tid := range ids {
		if _, err := s.exec(tx, `INSERT INTO task_tags (task_id,tag_id) VALUES (?,?) ON CONFLICT(task_id,tag_id) DO NOTHING`, taskID, tid); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CreateTask(t Task) (*Task, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// 新任务排到同状态列末尾
	var maxPos float64
	if err := s.queryRow(tx, `SELECT COALESCE(MAX(position),0) FROM tasks WHERE status=? AND archived=0 AND deleted_at IS NULL`, string(t.Status)).Scan(&maxPos); err != nil {
		return nil, err
	}
	t.Position = maxPos + 1
	// created_by 为空字符串时存 NULL（匿名/历史数据）
	var createdBy any
	if t.CreatedBy != "" {
		createdBy = t.CreatedBy
	}
	if _, err := s.exec(tx, `INSERT INTO tasks (id,title,content,status,position,due_date,archived,deleted_at,created_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,0,NULL,?,?,?)`,
		t.ID, t.Title, t.Content, string(t.Status), t.Position, t.DueDate, createdBy, t.CreatedAt, t.UpdatedAt); err != nil {
		return nil, err
	}
	if err := s.setTaskTags(tx, t.ID, t.Tags); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetTask(t.ID)
}

func (s *Store) UpdateTask(t Task) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := s.exec(tx, `UPDATE tasks SET title=?,content=?,status=?,position=?,due_date=?,archived=?,updated_at=? WHERE id=?`,
		t.Title, t.Content, string(t.Status), t.Position, t.DueDate, boolInt(t.Archived), t.UpdatedAt, t.ID); err != nil {
		return err
	}
	if err := s.setTaskTags(tx, t.ID, t.Tags); err != nil {
		return err
	}
	return tx.Commit()
}

// SoftDeleteTask 软删：置 deleted_at（幂等，已删再删直接返回）。
func (s *Store) SoftDeleteTask(id string) error {
	_, err := s.exec(s.db, `UPDATE tasks SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL`, now(), now(), id)
	return err
}

// RestoreTask 回收站恢复：清 deleted_at。
func (s *Store) RestoreTask(id string) error {
	_, err := s.exec(s.db, `UPDATE tasks SET deleted_at=NULL, updated_at=? WHERE id=?`, now(), id)
	return err
}

// DeleteTask 物理删除（回收站彻底删除）：claims/progress/deps/task_tags 由外键 CASCADE 级联清理。
func (s *Store) DeleteTask(id string) error {
	_, err := s.exec(s.db, `DELETE FROM tasks WHERE id=?`, id)
	return err
}

func (s *Store) TaskTitle(id string) string {
	var title string
	s.queryRow(s.db, `SELECT title FROM tasks WHERE id=?`, id).Scan(&title)
	return title
}

// ---- 认领 ----

func (s *Store) AddClaim(taskID, userID string) error {
	_, err := s.exec(s.db, `INSERT INTO claims (id,task_id,user_id,created_at) VALUES (?,?,?,?)`, newID(), taskID, userID, now())
	return err
}

func (s *Store) RemoveClaim(taskID, userID string) error {
	_, err := s.exec(s.db, `DELETE FROM claims WHERE task_id=? AND user_id=?`, taskID, userID)
	return err
}

func (s *Store) ClaimExists(taskID, userID string) (bool, error) {
	var n int
	err := s.queryRow(s.db, `SELECT COUNT(*) FROM claims WHERE task_id=? AND user_id=?`, taskID, userID).Scan(&n)
	return n > 0, err
}

// ---- 进度 ----

func (s *Store) AddProgress(p Progress) error {
	_, err := s.exec(s.db, `INSERT INTO progress (id,task_id,user_id,percent,text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`,
		p.ID, p.TaskID, p.UserID, p.Percent, p.Text, p.CreatedAt, p.UpdatedAt)
	return err
}

func (s *Store) GetProgress(id string) (*Progress, error) {
	var p Progress
	err := s.queryRow(s.db, `SELECT p.id,p.task_id,p.user_id,COALESCE(u.display_name,''),p.percent,p.text,p.created_at,p.updated_at
        FROM progress p JOIN users u ON u.id=p.user_id WHERE p.id=?`, id).
		Scan(&p.ID, &p.TaskID, &p.UserID, &p.Author, &p.Percent, &p.Text, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &p, err
}

func (s *Store) UpdateProgress(p Progress) error {
	_, err := s.exec(s.db, `UPDATE progress SET percent=?,text=?,updated_at=? WHERE id=?`, p.Percent, p.Text, p.UpdatedAt, p.ID)
	return err
}

func (s *Store) DeleteProgress(id string) error {
	_, err := s.exec(s.db, `DELETE FROM progress WHERE id=?`, id)
	return err
}

// ---- 评论 ----

// ListComments 某任务的全部评论（含回复），按时间正序（顶层与回复交错统一按 created_at）。
// 返回扁平列表，parent_id 由前端组装回复树。
func (s *Store) ListComments(taskID string) ([]Comment, error) {
	rows, err := s.query(s.db, `SELECT c.id,c.task_id,COALESCE(c.user_id,''),
        COALESCE(NULLIF(c.parent_id,''),''),COALESCE(u.display_name,'已注销'),
        c.content,c.created_at,c.updated_at
        FROM comments c LEFT JOIN users u ON u.id=c.user_id
        WHERE c.task_id = ?
        ORDER BY c.created_at ASC, c.id ASC`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.TaskID, &c.UserID, &c.ParentID, &c.Author,
			&c.Content, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) AddComment(c Comment) error {
	_, err := s.exec(s.db, `INSERT INTO comments (id,task_id,user_id,parent_id,content,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?)`,
		c.ID, c.TaskID, nullStr(c.UserID), nullStr(c.ParentID), c.Content, c.CreatedAt, c.UpdatedAt)
	return err
}

func (s *Store) GetComment(id string) (*Comment, error) {
	var c Comment
	err := s.queryRow(s.db, `SELECT c.id,c.task_id,COALESCE(c.user_id,''),
        COALESCE(NULLIF(c.parent_id,''),''),COALESCE(u.display_name,'已注销'),
        c.content,c.created_at,c.updated_at
        FROM comments c LEFT JOIN users u ON u.id=c.user_id
        WHERE c.id=?`, id).
		Scan(&c.ID, &c.TaskID, &c.UserID, &c.ParentID, &c.Author,
			&c.Content, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &c, err
}

func (s *Store) UpdateComment(id, content, ts string) error {
	_, err := s.exec(s.db, `UPDATE comments SET content=?,updated_at=? WHERE id=?`, content, ts, id)
	return err
}

// DeleteComment 物理删除评论；回复经外键 ON DELETE CASCADE 一并清除。
func (s *Store) DeleteComment(id string) error {
	_, err := s.exec(s.db, `DELETE FROM comments WHERE id=?`, id)
	return err
}

// ---- 排序 ----

// ReorderTasks 以给定顺序重写某状态下所有任务的 position（事务）。
func (s *Store) ReorderTasks(status Status, ids []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 该状态现存（未软删）任务集合
	rows, err := s.query(tx, `SELECT id FROM tasks WHERE status=? AND archived=0 AND deleted_at IS NULL`, string(status))
	if err != nil {
		return err
	}
	exist := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		exist[id] = true
	}
	rows.Close()
	// 给定顺序之外的任务（如并发新增）排到末尾
	seen := map[string]bool{}
	pos := 1.0
	for _, id := range ids {
		if !exist[id] || seen[id] {
			continue
		}
		if _, err := s.exec(tx, `UPDATE tasks SET position=? WHERE id=?`, pos, id); err != nil {
			return err
		}
		seen[id] = true
		pos++
	}
	for id := range exist {
		if !seen[id] {
			if _, err := s.exec(tx, `UPDATE tasks SET position=? WHERE id=?`, pos, id); err != nil {
				return err
			}
			pos++
		}
	}
	return tx.Commit()
}

// ---- 依赖 ----

func (s *Store) AddDep(taskID, depID string) error {
	_, err := s.exec(s.db, `INSERT INTO deps (task_id,dep_id,created_at) VALUES (?,?,?) ON CONFLICT(task_id,dep_id) DO NOTHING`, taskID, depID, now())
	return err
}

func (s *Store) RemoveDep(taskID, depID string) error {
	_, err := s.exec(s.db, `DELETE FROM deps WHERE task_id=? AND dep_id=?`, taskID, depID)
	return err
}

// WouldCycle reports whether adding edge taskID->depID creates a dependency
// cycle: taskID depends on depID, so a cycle exists iff depID transitively
// depends on taskID (i.e. depID reaches taskID following dep edges).
func (s *Store) WouldCycle(taskID, depID string) (bool, error) {
	if taskID == depID {
		return true, nil
	}
	seen := map[string]bool{}
	queue := []string{depID}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		rows, err := s.query(s.db, `SELECT dep_id FROM deps WHERE task_id=?`, cur)
		if err != nil {
			return false, err
		}
		var next []string
		for rows.Next() {
			var d string
			if err := rows.Scan(&d); err != nil {
				rows.Close()
				return false, err
			}
			if d == taskID {
				rows.Close()
				return true, nil
			}
			if !seen[d] {
				seen[d] = true
				next = append(next, d)
			}
		}
		rows.Close()
		queue = append(queue, next...)
	}
	return false, nil
}

// ---- 统计 ----

// Stats 聚合统计：分布/计数用 GROUP BY，任务进度在应用层平均（无认领进度视为 0）。
func (s *Store) Stats() (*Stats, error) {
	out := &Stats{ByStatus: []TaskStat{}, ByTag: []TagStat{}, ByCreator: []CreatorStat{}, ByMember: []MemberWorkload{}}

	// 总数 + 状态分布（未删未归档）
	rows, err := s.query(s.db, `SELECT status, COUNT(*) FROM tasks WHERE deleted_at IS NULL AND archived=0 GROUP BY status`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			rows.Close()
			return nil, err
		}
		out.TaskTotal += n
		switch st {
		case string(StatusTodo):
			out.Todo = n
		case string(StatusInProgress):
			out.InProgress = n
		case string(StatusDone):
			out.Done = n
		}
		out.ByStatus = append(out.ByStatus, TaskStat{Status: st, Count: n})
	}
	rows.Close()

	// 归档数
	if err := s.queryRow(s.db, `SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND archived=1`).Scan(&out.Archived); err != nil {
		return nil, err
	}
	// 逾期数（未完成且 due_date < 今天）
	today := time.Now().UTC().Format("2006-01-02")
	if err := s.queryRow(s.db, `SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND archived=0 AND status<>'done' AND due_date IS NOT NULL AND due_date<?`, today).Scan(&out.Overdue); err != nil {
		return nil, err
	}

	// 任务平均进度：认领者的最新一条进度记录平均（无记录=0）
	rows, err = s.query(s.db, `SELECT COALESCE(AVG(p.percent),0) FROM progress p
		JOIN tasks t ON t.id=p.task_id WHERE t.deleted_at IS NULL AND t.archived=0`)
	if err != nil {
		return nil, err
	}
	if rows.Next() {
		if err := rows.Scan(&out.AvgTaskPct); err != nil {
			rows.Close()
			return nil, err
		}
	}
	rows.Close()

	// 标签分布（仅未删未归档任务）
	rows, err = s.query(s.db, `SELECT tg.name, COUNT(*) FROM task_tags tt
		JOIN tags tg ON tg.id=tt.tag_id
		JOIN tasks t ON t.id=tt.task_id
		WHERE t.deleted_at IS NULL AND t.archived=0
		GROUP BY tg.name ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var ts TagStat
		if err := rows.Scan(&ts.Tag, &ts.Count); err != nil {
			rows.Close()
			return nil, err
		}
		out.ByTag = append(out.ByTag, ts)
	}
	rows.Close()

	// 按创建人分布（匿名/无创建人计为「匿名」）
	rows, err = s.query(s.db, `SELECT COALESCE(u.display_name,'匿名'), COUNT(*) FROM tasks t
		LEFT JOIN users u ON u.id=t.created_by
		WHERE t.deleted_at IS NULL AND t.archived=0
		GROUP BY t.created_by, u.display_name ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var cs CreatorStat
		if err := rows.Scan(&cs.UserName, &cs.Count); err != nil {
			rows.Close()
			return nil, err
		}
		out.ByCreator = append(out.ByCreator, cs)
	}
	rows.Close()

	// 成员工作量：认领任务数 + 其全部进度记录平均（无进度记录记 0 由 AVG 忽略）
	rows, err = s.query(s.db, `SELECT c.user_id, COALESCE(u.display_name,'已注销'),
		COUNT(DISTINCT c.task_id), COALESCE(AVG(p.percent),0)
		FROM claims c
		JOIN users u ON u.id=c.user_id
		LEFT JOIN progress p ON p.task_id=c.task_id AND p.user_id=c.user_id
		JOIN tasks t ON t.id=c.task_id
		WHERE t.deleted_at IS NULL
		GROUP BY c.user_id, u.display_name ORDER BY COUNT(DISTINCT c.task_id) DESC`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var mw MemberWorkload
		if err := rows.Scan(&mw.UserID, &mw.UserName, &mw.TaskCount, &mw.AvgPct); err != nil {
			rows.Close()
			return nil, err
		}
		out.ByMember = append(out.ByMember, mw)
	}
	rows.Close()

	return out, nil
}

// ---- 动态 ----

func (s *Store) AddActivity(a Activity) error {
	_, err := s.exec(s.db, `INSERT INTO activities (id,action,target,target_id,task_title,user_id,created_at) VALUES (?,?,?,?,?,?,?)`,
		a.ID, a.Action, a.Target, a.TargetID, a.TaskTitle, nullStr(a.UserID), a.CreatedAt)
	return err
}

// ListActivities 动态列表；authorName 来自 users.display_name JOIN（user_id 为空 → 显示「已注销」）。
func (s *Store) ListActivities(limit int) ([]Activity, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.query(s.db, `SELECT a.id,a.action,a.target,a.target_id,a.task_title,
        COALESCE(a.user_id,''),COALESCE(u.display_name,'已注销'),a.created_at
        FROM activities a LEFT JOIN users u ON u.id=a.user_id
        ORDER BY a.created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.Action, &a.Target, &a.TargetID, &a.TaskTitle,
			&a.UserID, &a.AuthorName, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Author = a.AuthorName // 兼容旧字段
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListActivitiesByTask 某任务的活动动态（按时间倒序），供任务详情时间线使用。
func (s *Store) ListActivitiesByTask(taskID string, limit int) ([]Activity, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.query(s.db, `SELECT a.id,a.action,a.target,a.target_id,a.task_title,
        COALESCE(a.user_id,''),COALESCE(u.display_name,'已注销'),a.created_at
        FROM activities a LEFT JOIN users u ON u.id=a.user_id
        WHERE a.target_id = ?
        ORDER BY a.created_at DESC LIMIT ?`, taskID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.Action, &a.Target, &a.TargetID, &a.TaskTitle,
			&a.UserID, &a.AuthorName, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.Author = a.AuthorName // 兼容旧字段
		out = append(out, a)
	}
	return out, rows.Err()
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
