package main

// 用户 / 角色 / 会话 / 系统设置 的存储层与种子数据。
// 密码一律 bcrypt 哈希存储，绝不明文；会话 token 用 crypto/rand 生成随机串存 sessions 表。

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const (
	roleTableAdmin  = "admin"
	roleTableMember = "member"
	roleTableViewer = "viewer"
)

var validRoles = map[string]bool{
	roleTableAdmin:  true,
	roleTableMember: true,
	roleTableViewer: true,
}

// roleRank 越大权限越高；用户多角色时取最高者。
var roleRank = map[string]int{
	roleTableViewer: 1,
	roleTableMember: 2,
	roleTableAdmin:  3,
}

var ErrUserNotFound = errors.New("用户不存在")

// anonymous 账号 id 缓存（启动时 Seed 预置后固定不变）。
var anonIDStore = struct {
	sync.Mutex
	id string
}{}

// AnonymousID 返回内置 anonymous 用户 id；未找到返回空串。
func (s *Store) AnonymousID() (string, error) {
	anonIDStore.Lock()
	defer anonIDStore.Unlock()
	if anonIDStore.id != "" {
		return anonIDStore.id, nil
	}
	var id string
	err := s.queryRow(s.db, `SELECT id FROM users WHERE username=?`, AnonUsername).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	anonIDStore.id = id
	return id, nil
}

// ---- 种子数据（启动时幂等执行） ----

// Seed 写入 roles 字典、预置 anonymous 隐藏账号与默认公开度。
// 首个注册用户自动成为 admin 的引导逻辑见 Register 流程。
func (s *Store) Seed() {
	roles := []struct{ code, desc string }{
		{roleTableAdmin, "管理员：全部权限"},
		{roleTableMember, "成员：业务读写"},
		{roleTableViewer, "访客：只读"},
	}
	for _, r := range roles {
		if _, err := s.exec(s.db, `INSERT INTO roles (id,code,description) VALUES (?,?,?) ON CONFLICT(code) DO NOTHING`,
			newID(), r.code, r.desc); err != nil {
			log.Warn().Err(err).Str("role", r.code).Msg("seed role")
		}
	}
	// 内置匿名账号：完全公开模式下未登录写操作回落的身份；display_name=匿名，
	// 角色 viewer（只读角色，实际写操作由公开度模式放行）。预置 password 为空（不可登录）。
	if err := s.ensureUser(AnonUsername, "", "匿名", roleTableViewer); err != nil {
		log.Warn().Err(err).Msg("seed anonymous user")
	}
	// 默认公开度
	if err := s.SetSetting(SettingPublicMode, defaultPublicMode); err != nil {
		log.Warn().Err(err).Msg("seed public_mode")
	}
}

// ensureUser 建号：已存在同名账号则仅补角色（不重置密码）。
func (s *Store) ensureUser(username, password, displayName, role string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var existing string
	err = s.queryRow(tx, `SELECT id FROM users WHERE username=?`, username).Scan(&existing)
	switch {
	case err == sql.ErrNoRows:
		hash := ""
		if password != "" {
			h, herr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
			if herr != nil {
				return herr
			}
			hash = string(h)
		}
		uid := newID()
		if _, err := s.exec(tx, `INSERT INTO users (id,username,password_hash,display_name,disabled,created_at) VALUES (?,?,?,?,0,?)`,
			uid, username, hash, displayName, now()); err != nil {
			return err
		}
		if err := s.grantRoleTx(tx, uid, role); err != nil {
			return err
		}
		return tx.Commit()
	case err != nil:
		return err
	}
	// 已存在：确保拥有目标角色
	if err := s.grantRoleTx(tx, existing, role); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) grantRoleTx(tx *sql.Tx, userID, roleCode string) error {
	var roleID string
	if err := s.queryRow(tx, `SELECT id FROM roles WHERE code=?`, roleCode).Scan(&roleID); err != nil {
		return err
	}
	_, err := s.exec(tx, `INSERT INTO user_roles (user_id,role_id) VALUES (?,?) ON CONFLICT(user_id,role_id) DO NOTHING`, userID, roleID)
	return err
}

// ---- 用户 ----

type userRow struct {
	ID           string
	Username     string
	PasswordHash string
	DisplayName  string
	Disabled     bool
	CreatedAt    string
}

// UserRoleCode 返回用户有效角色 code（多角色取权限最高者）。
func (s *Store) UserRoleCode(userID string) (string, error) {
	rows, err := s.query(s.db, `SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?`, userID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	best := ""
	bestRank := 0
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return "", err
		}
		if roleRank[code] > bestRank {
			best = code
			bestRank = roleRank[code]
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if best == "" {
		return "", fmt.Errorf("用户无角色")
	}
	return best, nil
}

func (s *Store) getUserByUsername(username string) (*userRow, error) {
	var u userRow
	var disabled int
	err := s.queryRow(s.db, `SELECT id,username,password_hash,display_name,disabled,created_at FROM users WHERE username=?`, username).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DisplayName, &disabled, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	u.Disabled = disabled != 0
	return &u, nil
}

func (s *Store) getUserByID(id string) (*userRow, error) {
	var u userRow
	var disabled int
	err := s.queryRow(s.db, `SELECT id,username,password_hash,display_name,disabled,created_at FROM users WHERE id=?`, id).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DisplayName, &disabled, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	u.Disabled = disabled != 0
	return &u, nil
}

// toUser 组装对外 User 视图（不含 password_hash）。
func (s *Store) toUser(u *userRow) (*User, error) {
	role, err := s.UserRoleCode(u.ID)
	if err != nil {
		return nil, err
	}
	return &User{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Role:        role,
		Disabled:    u.Disabled,
		CreatedAt:   u.CreatedAt,
	}, nil
}

// UserCount 用户总数（不含内置 anonymous）。
func (s *Store) UserCount() (int, error) {
	var n int
	err := s.queryRow(s.db, `SELECT COUNT(*) FROM users WHERE username<>?`, AnonUsername).Scan(&n)
	return n, err
}

// Register 注册新用户。系统尚无任何真实用户时，首位注册者自动获得 admin 角色（部署引导）。
// 返回 (user, 是否为首位 admin)。
func (s *Store) Register(username, password, displayName string) (*User, bool, error) {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return nil, false, errors.New("用户名与密码不能为空")
	}
	if len(password) < 6 {
		return nil, false, errors.New("密码长度至少 6 位")
	}
	if username == AnonUsername {
		return nil, false, errors.New("该用户名已被占用")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, false, err
	}
	count, err := s.UserCount()
	if err != nil {
		return nil, false, err
	}
	first := count == 0
	role := roleTableMember
	if first {
		role = roleTableAdmin
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	uid := newID()
	if _, err := s.exec(tx, `INSERT INTO users (id,username,password_hash,display_name,disabled,created_at) VALUES (?,?,?,?,0,?)`,
		uid, username, hash, displayName, now()); err != nil {
		return nil, false, err
	}
	if err := s.grantRoleTx(tx, uid, role); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	u, err := s.getUserByID(uid)
	if err != nil {
		return nil, false, err
	}
	user, err := s.toUser(u)
	return user, first, err
}

// VerifyPassword 校验登录：返回 (user, ok)。disabled 或密码错 → ok=false（不泄露具体原因）。
func (s *Store) VerifyPassword(username, password string) (*User, bool, error) {
	u, err := s.getUserByUsername(username)
	if err == ErrUserNotFound {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if u.Disabled {
		return nil, false, nil
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, false, nil
	}
	user, err := s.toUser(u)
	return user, true, err
}

// ListUsers 用户管理列表（不含内置 anonymous）。
// 注意：先全量扫描并关闭外层 rows，再逐个补查角色——若在 rows.Next() 循环内
// 调用 UserRoleCode（内部再开一条查询），在 MaxOpenConns=1 下外层 rows 独占
// 唯一连接，内层查询会自死锁。本实现先收齐行、显式 Close，再统一补角色。
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.query(s.db, `SELECT id,username,display_name,disabled,created_at FROM users WHERE username<>? ORDER BY created_at`, AnonUsername)
	if err != nil {
		return nil, err
	}
	var out []User
	for rows.Next() {
		var u User
		var disabled int
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &disabled, &u.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		u.Disabled = disabled != 0
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	// 关闭外层 rows 释放连接后，再为每个用户补角色
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for i := range out {
		role, err := s.UserRoleCode(out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Role = role
	}
	return out, nil
}

// SetUserRole 重设用户角色（先删后插）。只允许三种合法 code。
func (s *Store) SetUserRole(userID, roleCode string) error {
	if !validRoles[roleCode] {
		return errors.New("无效的角色")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var exists string
	if err := s.queryRow(tx, `SELECT id FROM users WHERE id=?`, userID).Scan(&exists); err != nil {
		return ErrUserNotFound
	}
	if _, err := s.exec(tx, `DELETE FROM user_roles WHERE user_id=?`, userID); err != nil {
		return err
	}
	if err := s.grantRoleTx(tx, userID, roleCode); err != nil {
		return err
	}
	return tx.Commit()
}

// SetUserDisabled 启停用用户。防止停用/删除自己见 handler 层保护。
func (s *Store) SetUserDisabled(userID string, disabled bool) error {
	_, err := s.exec(s.db, `UPDATE users SET disabled=? WHERE id=?`, boolInt(disabled), userID)
	return err
}

// UpdateSelf 个人中心：改展示名与/或密码。newPassword 为空表示不改密码；
// 返回更新后的 User 视图。
func (s *Store) UpdateSelf(userID, displayName, newPassword string) (*User, error) {
	u, err := s.getUserByID(userID)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	hash := u.PasswordHash
	if newPassword != "" {
		if len(newPassword) < 6 {
			return nil, errors.New("密码长度至少 6 位")
		}
		h, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		hash = string(h)
	}
	if _, err := s.exec(tx, `UPDATE users SET display_name=?, password_hash=? WHERE id=?`,
		displayName, hash, userID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	u.DisplayName = displayName
	u.PasswordHash = hash
	return s.toUser(u)
}

// CheckPassword 校验给定密码是否匹配该用户（个人中心改密前验证旧密码）。
func (s *Store) CheckPassword(userID, password string) (bool, error) {
	u, err := s.getUserByID(userID)
	if err != nil {
		return false, err
	}
	return bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) == nil, nil
}

// ---- 会话 ----

const sessionTTL = 30 * 24 * time.Hour // 30 天

// CreateSession 生成随机 token 并入库。
func (s *Store) CreateSession(userID string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)
	expires := time.Now().UTC().Add(sessionTTL).Format(time.RFC3339)
	if _, err := s.exec(s.db, `INSERT INTO sessions (token,user_id,expires_at,created_at) VALUES (?,?,?,?)`,
		token, userID, expires, now()); err != nil {
		return "", err
	}
	return token, nil
}

// UserByToken 校验会话 token：存在且未过期 → 返回对应用户；无效/过期/停用 → nil。
// 过期会话顺手清理后重试一次（消除竞态）。
func (s *Store) UserByToken(token string) (*User, error) {
	u, expired, err := s.userByTokenInternal(token)
	if err != nil {
		return nil, err
	}
	if u == nil && expired {
		u2, _, err2 := s.userByTokenInternal(token)
		return u2, err2
	}
	return u, err
}

func (s *Store) userByTokenInternal(token string) (*User, bool, error) {
	var u userRow
	var disabled int
	var expiresAt string
	err := s.queryRow(s.db, `SELECT u.id,u.username,u.password_hash,u.display_name,u.disabled,u.created_at,s.expires_at
        FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?`, token).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.DisplayName, &disabled, &u.CreatedAt, &expiresAt)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	u.Disabled = disabled != 0
	exp, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		_, _ = s.exec(s.db, `DELETE FROM sessions WHERE token=?`, token)
		return nil, false, nil
	}
	if time.Now().UTC().After(exp) {
		_, _ = s.exec(s.db, `DELETE FROM sessions WHERE token=?`, token)
		return nil, true, nil
	}
	if u.Disabled {
		return nil, false, nil
	}
	user, err := s.toUser(&u)
	return user, false, err
}

// DeleteSession 登出：删除该 token。
func (s *Store) DeleteSession(token string) error {
	_, err := s.exec(s.db, `DELETE FROM sessions WHERE token=?`, token)
	return err
}

// ---- 系统设置 ----

const SettingPublicMode = "public_mode"

// PublicMode 返回当前公开度模式（非法值或缺失回退默认 private）。
func (s *Store) PublicMode() (string, error) {
	var v string
	err := s.queryRow(s.db, `SELECT value FROM settings WHERE key=?`, SettingPublicMode).Scan(&v)
	if err == sql.ErrNoRows {
		return defaultPublicMode, nil
	}
	if err != nil {
		return "", err
	}
	switch v {
	case ModePrivate, ModeReadonly, ModeOpen:
		return v, nil
	default:
		return defaultPublicMode, nil
	}
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.exec(s.db, `INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
		key, value, now())
	return err
}

// GetSetting 读单条设置；不存在返回 ("", nil)。
func (s *Store) GetSetting(key string) (string, error) {
	var v string
	err := s.queryRow(s.db, `SELECT value FROM settings WHERE key=?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}
