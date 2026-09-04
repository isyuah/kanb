export type Status = 'todo' | 'in_progress' | 'done'

export type Role = 'admin' | 'member' | 'viewer'

/** 公开度：private 完全登录门；readonly 游客可浏览不可写；open 免登录读写 */
export type PublicMode = 'private' | 'readonly' | 'open'

export interface User {
  id: string
  username: string
  displayName: string
  role: Role
  disabled: boolean
  createdAt: string
}

export interface AuthResult {
  token: string
  user: User
}

export interface Dep {
  id?: string
  taskId: string
  depId: string
  title: string
  status: Status
  archived: boolean
}

export interface Claim {
  id: string
  taskId: string
  /** 认领人（displayName） */
  claimer: string
  /** 认领人用户 id（匿名可空） */
  userId?: string | null
  createdAt: string
}

export interface ProgressEntry {
  id: string
  taskId: string
  /** 记录人（displayName） */
  author: string
  /** 记录人用户 id（匿名可空） */
  userId?: string | null
  percent: number
  text: string
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  title: string
  content: string
  status: Status
  position: number
  dueDate?: string | null
  tags: string[]
  archived: boolean
  /** 软删时间；非空 = 已进回收站 */
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  /** 创建人用户 id（匿名/旧数据可空） */
  createdBy: string | null
  /** 创建人展示名（用户已注销为 null） */
  createdByName: string | null
  deps: Dep[]
  claims: Claim[]
  progress: ProgressEntry[]
}

export interface Activity {
  id: string
  action: string
  target: string
  targetId: string
  taskTitle: string
  /** 操作人展示名（老数据缺失时用 authorName） */
  author?: string | null
  /** 用户展示名；用户已注销/匿名 → null */
  authorName: string | null
  userId?: string | null
  createdAt: string
}

export interface Settings {
  publicMode: PublicMode
}

/* ---------------- 统计 ---------------- */

export interface TaskStat {
  status: Status
  count: number
}

export interface TagStat {
  tag: string
  count: number
}

export interface CreatorStat {
  userId?: string
  userName?: string
  count: number
}

export interface MemberWorkload {
  userId?: string
  userName: string
  taskCount: number
  avgPct: number
}

export interface Stats {
  taskTotal: number
  todo: number
  inProgress: number
  done: number
  overdue: number
  archived: number
  avgTaskPct: number
  byStatus: TaskStat[]
  byTag: TagStat[]
  byCreator: CreatorStat[]
  byMember: MemberWorkload[]
}

export interface TaskInput {
  title: string
  content?: string
  status?: Status
  dueDate?: string | null
  tags?: string[]
}

export interface TaskPatch {
  title?: string
  content?: string
  status?: Status
  dueDate?: string | null
  tags?: string[]
  archived?: boolean
}

export interface UserInput {
  username: string
  password: string
  displayName?: string
  role?: Role
}

export interface UserPatch {
  password?: string
  displayName?: string
  role?: Role
  disabled?: boolean
}

export const ROLES: Role[] = ['admin', 'member', 'viewer']

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理员',
  member: '成员',
  viewer: '只读',
}

export const PUBLIC_MODE_LABELS: Record<PublicMode, string> = {
  private: '私有',
  readonly: '公开只读',
  open: '完全公开',
}

export const PUBLIC_MODE_DESC: Record<PublicMode, string> = {
  private: '仅登录成员可见。未登录访客只能看到登录/注册页。',
  readonly: '访客可浏览全部数据，但不可创建、认领或修改。写操作需登录。',
  open: '无需登录即可浏览与操作。匿名写操作将记录为内置 anonymous 账号。',
}

export const STATUS_META: Record<
  Status,
  { label: string; color: string }
> = {
  todo: { label: '待认领', color: 'default' },
  in_progress: { label: '进行中', color: 'processing' },
  done: { label: '已完成', color: 'success' },
}

export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'done']

export const ACTION_LABELS: Record<string, string> = {
  created: '创建了任务',
  updated: '更新了任务',
  deleted: '删除了任务',
  restored: '恢复了任务',
  purged: '彻底删除了任务',
  archived: '归档了任务',
  unarchived: '恢复了任务',
  claimed: '认领了任务',
  unclaimed: '取消了认领',
  progress: '更新了进度',
  progress_updated: '修改了进度',
  progress_deleted: '删除了进度',
  dep_added: '添加了依赖',
  dep_removed: '移除了依赖',
}
