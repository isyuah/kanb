import type { Activity, ProgressEntry, Task, TaskInput, TaskPatch } from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
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

function authorHeader(author: string): HeadersInit {
  // HTTP headers must be ISO-8859-1; encode UTF-8 names (e.g. Chinese) safely.
  return { 'X-Author': encodeURIComponent(author) }
}

export const api = {
  listTasks: (includeArchived = false) =>
    request<Task[]>(`/tasks?includeArchived=${includeArchived}`),

  createTask: (author: string, input: TaskInput) =>
    request<Task>('/tasks', {
      method: 'POST',
      headers: authorHeader(author),
      body: JSON.stringify(input),
    }),

  patchTask: (author: string, id: string, patch: TaskPatch) =>
    request<Task>(`/tasks/${id}`, {
      method: 'PATCH',
      headers: authorHeader(author),
      body: JSON.stringify(patch),
    }),

  deleteTask: (author: string, id: string) =>
    request<void>(`/tasks/${id}`, { method: 'DELETE', headers: authorHeader(author) }),

  reorder: (author: string, status: string, ids: string[]) =>
    request<void>('/tasks/reorder', {
      method: 'PUT',
      headers: authorHeader(author),
      body: JSON.stringify({ status, ids }),
    }),

  claim: (author: string, id: string) =>
    request<void>(`/tasks/${id}/claim`, { method: 'POST', headers: authorHeader(author) }),

  unclaim: (author: string, id: string) =>
    request<void>(`/tasks/${id}/claim`, { method: 'DELETE', headers: authorHeader(author) }),

  addProgress: (author: string, taskId: string, percent: number, text: string) =>
    request<ProgressEntry>(`/tasks/${taskId}/progress`, {
      method: 'POST',
      headers: authorHeader(author),
      body: JSON.stringify({ percent, text }),
    }),

  updateProgress: (author: string, id: string, percent: number, text: string) =>
    request<ProgressEntry>(`/progress/${id}`, {
      method: 'PUT',
      headers: authorHeader(author),
      body: JSON.stringify({ percent, text }),
    }),

  deleteProgress: (author: string, id: string) =>
    request<void>(`/progress/${id}`, { method: 'DELETE', headers: authorHeader(author) }),

  addDep: (author: string, taskId: string, depId: string) =>
    request<void>(`/tasks/${taskId}/deps`, {
      method: 'POST',
      headers: authorHeader(author),
      body: JSON.stringify({ depId }),
    }),

  removeDep: (author: string, taskId: string, depId: string) =>
    request<void>(`/tasks/${taskId}/deps/${depId}`, {
      method: 'DELETE',
      headers: authorHeader(author),
    }),

  activities: (limit = 50) => request<Activity[]>(`/activities?limit=${limit}`),
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
