import { create } from 'zustand'
import { api, subscribeEvents } from './api'
import type { Activity, Task } from './types'

const ME_KEY = 'kanb.me'
const TASKS_KEY = 'kanb.tasks.cache.v1'
const ACT_KEY = 'kanb.activities.cache.v1'

export function loadMe(): string {
  try {
    return localStorage.getItem(ME_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveMe(name: string) {
  try {
    localStorage.setItem(ME_KEY, name)
  } catch {
    /* ignore */
  }
}

interface KanbanState {
  me: string
  tasks: Task[]
  activities: Activity[]
  loaded: boolean
  error: string | null

  setMe: (name: string) => void
  refresh: () => Promise<void>
  refreshActivities: () => Promise<void>
  /** SSE-driven incremental reload of a task */
  onRemoteChange: (taskId: string | null) => Promise<void>
  /** refresh + reload activity feed together after a local mutation */
  commit: () => Promise<void>

  createTask: (input: { title: string; content?: string; tags?: string[]; dueDate?: string | null }) => Promise<Task>
  patchTask: (id: string, patch: Parameters<typeof api.patchTask>[2]) => Promise<void>
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
  // Reconcile optimistic mutations: SSE refresh could clobber a just-applied change.
  const refreshFromServer = async () => {
    try {
      const tasks = await api.listTasks(false)
      set({ tasks, loaded: true, error: null })
      cacheTasks(tasks)
    } catch (e) {
      set({ error: (e as Error).message })
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
    me: loadMe(),
    tasks: [],
    activities: [],
    loaded: false,
    error: null,

    setMe: (name) => {
      saveMe(name)
      set({ me: name })
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
      const author = get().me || '匿名'
      const task = await api.createTask(author, input)
      await commit()
      return task
    },

    patchTask: async (id, patch) => {
      const author = get().me || '匿名'
      await api.patchTask(author, id, patch)
      await commit()
    },

    deleteTask: async (id) => {
      const author = get().me || '匿名'
      await api.deleteTask(author, id)
      await commit()
    },

    claimTask: async (id) => {
      const author = get().me || '匿名'
      await api.claim(author, id)
      await commit()
    },

    unclaimTask: async (id) => {
      const author = get().me || '匿名'
      await api.unclaim(author, id)
      await commit()
    },

    addProgress: async (taskId, percent, text) => {
      const author = get().me || '匿名'
      await api.addProgress(author, taskId, percent, text)
      await commit()
    },

    updateProgress: async (progressId, percent, text) => {
      const author = get().me || '匿名'
      await api.updateProgress(author, progressId, percent, text)
      await commit()
    },

    deleteProgress: async (progressId) => {
      const author = get().me || '匿名'
      await api.deleteProgress(author, progressId)
      await commit()
    },

    addDep: async (taskId, depId) => {
      const author = get().me || '匿名'
      await api.addDep(author, taskId, depId)
      await commit()
    },

    removeDep: async (taskId, depId) => {
      const author = get().me || '匿名'
      await api.removeDep(author, taskId, depId)
      await commit()
    },

    archiveTask: async (id, archived) => {
      const author = get().me || '匿名'
      await api.patchTask(author, id, { archived })
      await commit()
    },

    reorderTasks: async (status, ids) => {
      const author = get().me || '匿名'
      await api.reorder(author, status, ids)
      await commit()
    },
  }
})

// One-time SSE wiring outside React.
let sseStarted = false
export function startSync() {
  if (sseStarted) return
  sseStarted = true
  subscribeEvents((taskId) => {
    void useKanban.getState().onRemoteChange(taskId)
  })
}
