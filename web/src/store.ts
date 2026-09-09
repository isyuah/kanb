import { create } from 'zustand'
import { api, setUnauthorizedHandler, subscribeEvents } from './api'
import { useUI } from './ui'
import type {
  Activity,
  AuthResult,
  PublicMode,
  Task,
  TaskInput,
  User,
} from './types'

const USER_KEY = 'kanb.user'
const TASKS_KEY = 'kanb.tasks.cache'
const ACT_KEY = 'kanb.activities.cache'

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const u = JSON.parse(raw) as User
    return u && typeof u === 'object' && typeof u.id === 'string' ? u : null
  } catch {
    return null
  }
}

function saveUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* ignore */
  }
}

/** 写能力：member/admin 恒可写；未登录仅 open（完全公开）模式可匿名写 */
export function canWrite(user: User | null, publicMode: PublicMode | null): boolean {
  if (user && (user.role === 'admin' || user.role === 'member')) return true
  if (!user) return publicMode === 'open'
  return false
}

/** 当前用户是否为 admin（离线状态也能先做 UI 层判断） */
export function isAdmin(u: User | null): boolean {
  return !!u && u.role === 'admin'
}

/** 是否显示回收站入口：admin/member（viewer 无删除能力） */
export function canManageTrash(u: User | null): boolean {
  return !!u && (u.role === 'admin' || u.role === 'member')
}

interface KanbanState {
  user: User | null
  tasks: Task[]
  activities: Activity[]
  loaded: boolean
  error: string | null
  /** 已拉取的公开度；null = 未知（如后端未就绪） */
  publicMode: PublicMode | null
  /** 已拉取的开放注册开关；null = 未知（按开放显示，后端兜底拒绝） */
  registration: boolean | null

  /** 登录/注册成功：保存 user + token */
  applyAuth: (r: AuthResult) => void
  /** 本地 user 快照更新（个人中心改展示名后同步持久层） */
  applyUser: (u: User) => void
  /** 登出：调后端会话失效 + 清本地身份。是否回登录门由 App 依 publicMode 决定 */
  logout: () => Promise<void>
  /** 401/会话失效：清本地登录态（不请求后端）。App 据此回落 */
  resetAuth: () => void
  refresh: () => Promise<void>
  refreshActivities: () => Promise<void>
  /** SSE-driven incremental reload of a task */
  onRemoteChange: (taskId: string | null) => Promise<void>
  /** refresh + reload activity feed together after a local mutation */
  commit: () => Promise<void>

  createTask: (input: TaskInput) => Promise<Task>
  patchTask: (id: string, patch: Parameters<typeof api.patchTask>[1]) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  claimTask: (id: string) => Promise<void>
  unclaimTask: (id: string) => Promise<void>
  addProgress: (taskId: string, percent: number, text: string) => Promise<void>
  updateProgress: (progressId: string, percent: number, text: string) => Promise<void>
  deleteProgress: (progressId: string) => Promise<void>
  addDep: (taskId: string, depId: string) => Promise<void>
  removeDep: (taskId: string, depId: string) => Promise<void>
  archiveTask: (id: string, archived: boolean) => Promise<void>
  reorderTasks: (status: string, ids: string[]) => Promise<void>
}

function cacheTasks(tasks: Task[]) {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
  } catch {
    /* ignore */
  }
}

function cacheActivities(acts: Activity[]) {
  try {
    localStorage.setItem(ACT_KEY, JSON.stringify(acts))
  } catch {
    /* ignore */
  }
}

export const useKanban = create<KanbanState>((set, get) => {
  // 公开度（GET /api/settings 免登录）+ 任务列表同步拉取。
  // settings 失败（后端未就绪）不阻塞任务尝试。
  const refreshFromServer = async () => {
    try {
      const s = await api.getSettings()
      set({ publicMode: s.publicMode, registration: s.registration })
    } catch {
      /* settings 拉取失败：保持原公开度 */
    }
    try {
      const tasks = await api.listTasks(false)
      set({ tasks, loaded: true, error: null })
      cacheTasks(tasks)
    } catch (e) {
      // 未登录 + private：401 属预期（登录门接管），不当作致命错误；
      // 无 token 时凭 settings 判定可浏览性，避免游客模式误报断连。
      const st = get()
      if (st.publicMode !== 'private' || st.user) {
        set({ error: (e as Error).message })
      } else {
        set({ loaded: true, error: null })
      }
    }
  }

  const refreshActivities = async () => {
    try {
      const acts = await api.activities(60)
      set({ activities: acts })
      cacheActivities(acts)
    } catch {
      /* non-critical */
    }
  }

  const commit = async () => {
    await refreshFromServer()
    await refreshActivities()
  }

  return {
    user: loadUser(),
    tasks: [],
    activities: [],
    loaded: false,
    error: null,
    publicMode: null,
    registration: null,

    applyAuth: (r) => {
      saveUser(r.user)
      api.setToken(r.token)
      set({ user: r.user })
    },

    applyUser: (u) => {
      saveUser(u)
      set({ user: u })
    },

    logout: async () => {
      saveUser(null)
      api.setToken(null)
      set({ user: null })
      try {
        await api.logout()
      } catch {
        /* 会话删除失败不影响本地登出 */
      }
    },

    resetAuth: () => {
      saveUser(null)
      api.setToken(null)
      set({ user: null })
    },

    refresh: refreshFromServer,
    refreshActivities,
    onRemoteChange: async (taskId) => {
      // Other client changed something. Refresh tasks; if it was an activity
      // worth reflecting, reload the feed too (best-effort).
      await refreshFromServer()
      if (taskId) await refreshActivities()
    },
    commit,

    createTask: async (input) => {
      const task = await api.createTask(input)
      await commit()
      return task
    },

    patchTask: async (id, patch) => {
      await api.patchTask(id, patch)
      await commit()
    },

    deleteTask: async (id) => {
      await api.deleteTask(id)
      await commit()
    },

    claimTask: async (id) => {
      await api.claim(id)
      await commit()
    },

    unclaimTask: async (id) => {
      await api.unclaim(id)
      await commit()
    },

    addProgress: async (taskId, percent, text) => {
      await api.addProgress(taskId, percent, text)
      await commit()
    },

    updateProgress: async (progressId, percent, text) => {
      await api.updateProgress(progressId, percent, text)
      await commit()
    },

    deleteProgress: async (progressId) => {
      await api.deleteProgress(progressId)
      await commit()
    },

    addDep: async (taskId, depId) => {
      await api.addDep(taskId, depId)
      await commit()
    },

    removeDep: async (taskId, depId) => {
      await api.removeDep(taskId, depId)
      await commit()
    },

    archiveTask: async (id, archived) => {
      await api.patchTask(id, { archived })
      await commit()
    },

    reorderTasks: async (status, ids) => {
      await api.reorder(status, ids)
      await commit()
    },
  }
})

// 401（会话失效）：清本地登录态；私密模式下 App 会自动回到登录门
setUnauthorizedHandler(() => {
  useKanban.getState().resetAuth()
  // 会话失效：回到看板（private 下 App 会自动展示登录门）
  useUI.getState().setView('board')
})

/** 组件侧统一权限视图：写按钮/回收站/管理入口的显隐与禁用 */
export function usePerms() {
  const user = useKanban((s) => s.user)
  const publicMode = useKanban((s) => s.publicMode)
  return {
    user,
    publicMode,
    writable: canWrite(user, publicMode),
    admin: isAdmin(user),
    trash: canManageTrash(user),
  }
}

// One-time SSE wiring outside React.
let sseStarted = false
export function startSync() {
  if (sseStarted) return
  sseStarted = true
  subscribeEvents((taskId) => {
    void useKanban.getState().onRemoteChange(taskId)
  })
}
