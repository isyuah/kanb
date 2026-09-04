import { create } from 'zustand'

export type View = 'board' | 'graph' | 'calendar' | 'trash' | 'users' | 'settings'
export type Filter = 'all' | 'mine' | 'overdue'

interface UIState {
  view: View
  query: string
  filter: Filter
  selectedId: string | null
  drawerOpen: boolean
  archiveOpen: boolean
  feedOpen: boolean
  newTaskOpen: boolean
  /** 个人中心抽屉 */
  profileOpen: boolean
  /** 登录/注册弹窗（readonly/open 未登录时） */
  loginOpen: boolean
  setView: (v: View) => void
  setQuery: (q: string) => void
  setFilter: (f: Filter) => void
  openTask: (id: string) => void
  closeTask: () => void
  setArchiveOpen: (open: boolean) => void
  setFeedOpen: (open: boolean) => void
  setNewTaskOpen: (open: boolean) => void
  setProfileOpen: (open: boolean) => void
  setLoginOpen: (open: boolean) => void
}

export const useUI = create<UIState>((set) => ({
  view: 'board',
  query: '',
  filter: 'all',
  selectedId: null,
  drawerOpen: false,
  archiveOpen: false,
  feedOpen: false,
  newTaskOpen: false,
  profileOpen: false,
  loginOpen: false,
  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  openTask: (id) => set({ selectedId: id, drawerOpen: true }),
  closeTask: () => set({ drawerOpen: false }),
  setArchiveOpen: (archiveOpen) => set({ archiveOpen }),
  setFeedOpen: (feedOpen) => set({ feedOpen }),
  setNewTaskOpen: (newTaskOpen) => set({ newTaskOpen }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setLoginOpen: (loginOpen) => set({ loginOpen }),
}))
