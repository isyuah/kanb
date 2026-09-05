import type {
  Activity,
  AuthResult,
  Comment,
  ProgressEntry,
  Settings,
  Stats,
  Task,
  TaskInput,
  TaskPatch,
  User,
} from './types'

const BASE = '/api'
export const TOKEN_KEY = 'kanb.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

/** 401 处理器：由 store 注册（清登录态 + 回登录门） */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

async function request<T>(path: string, init?: RequestInit, noAuth = false): Promise<T> {
  const token = noAuth ? null : getToken()
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    if (res.status === 401 && !noAuth) {
      // 未授权/会话失效：清除本地登录态，由 App 决定按公开度回落
      setToken(null)
      try {
        onUnauthorized?.()
      } catch {
        /* ignore */
      }
    }
    let msg = `请求失败 (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  /* ---------------- 认证 ---------------- */
  register: (username: string, password: string, displayName?: string) =>
    request<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    }, true),

  login: (username: string, password: string) =>
    request<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }, true),

  logout: () =>
    request<void>('/auth/logout', { method: 'POST' }),

  /** 解析 Authorization token（logout 时清本地存储用） */
  setToken,

  /* ---------------- 个人中心 ---------------- */
  /** 当前登录用户信息 */
  getMe: () => request<User>('/me'),
  /** 改自己的展示名/密码（改密码需带旧密码） */
  updateMe: (patch: { displayName?: string; password?: string; oldPassword?: string }) =>
    request<User>('/me', {
      method: 'PUT',
      body: JSON.stringify({
        displayName: patch.displayName ?? '',
        ...(patch.oldPassword ? { oldPassword: patch.oldPassword } : {}),
        newPassword: patch.password ?? '',
      }),
    }),

  /* ---------------- 用户管理（admin） ---------------- */
  listUsers: () => request<User[]>('/users'),
  /** 后端无 POST/PATCH /api/users —— 仅提供角色/停用管理。创建用户由注册页自助完成 */
  setUserRole: (id: string, role: string) =>
    request<void>(`/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  setUserDisabled: (id: string, disabled: boolean) =>
    request<void>(`/users/${id}/disabled`, {
      method: 'PUT',
      body: JSON.stringify({ disabled }),
    }),

  /* ---------------- 系统设置 ---------------- */
  getSettings: () => request<Settings>('/settings'),
  updateSettings: (patch: { publicMode: string }) =>
    request<Settings>('/settings/public-mode', { method: 'PUT', body: JSON.stringify(patch) }),

  /* ---------------- 任务 ---------------- */
  listTasks: (includeArchived = false) =>
    request<Task[]>(`/tasks?includeArchived=${includeArchived ? '1' : '0'}`),

  createTask: (input: TaskInput) =>
    request<Task>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  patchTask: (id: string, patch: TaskPatch) =>
    request<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteTask: (id: string) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE' }),

  reorder: (status: string, ids: string[]) =>
    request<void>('/tasks/reorder', {
      method: 'PUT',
      body: JSON.stringify({ status, ids }),
    }),

  claim: (id: string) =>
    request<void>(`/tasks/${id}/claim`, { method: 'POST' }),

  unclaim: (id: string) =>
    request<void>(`/tasks/${id}/claim`, { method: 'DELETE' }),

  addProgress: (taskId: string, percent: number, text: string) =>
    request<ProgressEntry>(`/tasks/${taskId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ percent, text }),
    }),

  updateProgress: (id: string, percent: number, text: string) =>
    request<ProgressEntry>(`/progress/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ percent, text }),
    }),

  deleteProgress: (id: string) =>
    request<void>(`/progress/${id}`, { method: 'DELETE' }),

  addDep: (taskId: string, depId: string) =>
    request<void>(`/tasks/${taskId}/deps`, {
      method: 'POST',
      body: JSON.stringify({ depId }),
    }),

  removeDep: (taskId: string, depId: string) =>
    request<void>(`/tasks/${taskId}/deps/${depId}`, {
      method: 'DELETE',
    }),

  activities: (limit = 50) => request<Activity[]>(`/activities?limit=${limit}`),

  /** 某任务完整操作时间线（后端按 target_id 过滤，非全局截断） */
  taskActivities: (taskId: string, limit = 200) =>
    request<Activity[]>(`/tasks/${taskId}/activities?limit=${limit}`),

  /* ---------------- 评论 ---------------- */
  listComments: (taskId: string) => request<Comment[]>(`/tasks/${taskId}/comments`),
  addComment: (taskId: string, content: string, parentId?: string) =>
    request<Comment>(`/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, parentId }),
    }),
  updateComment: (commentId: string, content: string) =>
    request<Comment>(`/comments/${commentId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteComment: (commentId: string) =>
    request<void>(`/comments/${commentId}`, { method: 'DELETE' }),

  /* ---------------- 统计 ---------------- */
  stats: () => request<Stats>('/stats'),

  /* ---------------- 回收站 ---------------- */
  listTrash: () => request<Task[]>('/trash'),
  restoreTrash: (id: string) =>
    request<Task>(`/trash/${id}/restore`, { method: 'POST' }),
  purgeTrash: (id: string) =>
    request<void>(`/trash/${id}`, { method: 'DELETE' }),
}

/** Subscribe to SSE change stream. Returns unsubscribe fn. */
export function subscribeEvents(onChange: (taskId: string | null) => void): () => void {
  let es: EventSource | null = null
  let closed = false

  function connect() {
    if (closed) return
    es = new EventSource('/api/events')
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data)
        if (data?.type === 'changed') onChange(data.taskId ?? null)
      } catch {
        /* ignore malformed */
      }
    }
    es.onerror = () => {
      es?.close()
      es = null
      if (!closed) setTimeout(connect, 1500)
    }
  }
  connect()
  return () => {
    closed = true
    es?.close()
  }
}
