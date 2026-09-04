package main

// Types shared between store and HTTP handlers.

type Status string

const (
	StatusTodo       Status = "todo"
	StatusInProgress Status = "in_progress"
	StatusDone       Status = "done"
)

// RBAC 三角色（DB 中存 roles 字典 + user_roles 多对多关联，代码层以 code 引用）
const (
	RoleAdmin  = "admin"
	RoleMember = "member"
	RoleViewer = "viewer"
)

// 匿名账号用户名：完全公开模式下未登录写操作回落的固定身份（users 表预置）。
const AnonUsername = "anonymous"

// 公开度模式（settings 表 key=public_mode 的取值）
const (
	ModePrivate  = "private"  // 不公开：匿名全拒（登录/注册除外）
	ModeReadonly = "readonly" // 公开只读：匿名可 GET，不可写
	ModeOpen     = "open"     // 完全公开：匿名可写（退化为免登录版）
)

// User 是返回给前端的用户视图（不含 password_hash）。
// Role 为有效角色 code：DB 中 user_roles 为多对多，取权限最高者返回。
type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Disabled    bool   `json:"disabled"`
	CreatedAt   string `json:"createdAt"`
}

type Task struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Content       string     `json:"content"`
	Status        Status     `json:"status"`
	Position      float64    `json:"position"`
	DueDate       *string    `json:"dueDate,omitempty"` // YYYY-MM-DD
	Tags          []string   `json:"tags"`
	Archived      bool       `json:"archived"`
	CreatedBy     string     `json:"createdBy,omitempty"`     // 创建者 user_id（历史数据可为空）
	CreatedByName string     `json:"createdByName,omitempty"` // 创建者展示名
	DeletedAt     string     `json:"deletedAt,omitempty"`     // 软删标记；非空表示在回收站
	CreatedAt     string     `json:"createdAt"`
	UpdatedAt     string     `json:"updatedAt"`
	Deps          []Dep      `json:"deps"`
	Claims        []Claim    `json:"claims"`
	Progress      []Progress `json:"progress"`
}

type Dep struct {
	ID       string `json:"id,omitempty"`
	TaskID   string `json:"taskId"`
	DepID    string `json:"depId"`
	Title    string `json:"title"`
	Status   Status `json:"status"`
	Archived bool   `json:"archived"`
}

// Claim 认领记录：UserID 为认领人 user_id，Claimer 为其展示名（兼容旧前端字段）。
type Claim struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	UserID    string `json:"userId,omitempty"`
	Claimer   string `json:"claimer"`
	CreatedAt string `json:"createdAt"`
}

// Progress 进度记录：UserID 为记录作者 user_id，Author 为其展示名（兼容旧前端字段）。
type Progress struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	UserID    string `json:"userId,omitempty"`
	Author    string `json:"author"`
	Percent   int    `json:"percent"`
	Text      string `json:"text"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// Activity 操作动态。UserID 可为空（对应用户被物理删除后 user_id 置 NULL），
// Author/AuthorName 均为展示名：user_id 为 NULL 时显示「已注销」。
type Activity struct {
	ID         string `json:"id"`
	Action     string `json:"action"`
	Target     string `json:"target"`
	TargetID   string `json:"targetId"`
	TaskTitle  string `json:"taskTitle"`
	UserID     string `json:"userId,omitempty"`
	Author     string `json:"author"`
	AuthorName string `json:"authorName"`
	CreatedAt  string `json:"createdAt"`
}

type TaskInput struct {
	Title   string   `json:"title"`
	Content string   `json:"content"`
	Status  Status   `json:"status"`
	DueDate *string  `json:"dueDate"`
	Tags    []string `json:"tags"`
}
