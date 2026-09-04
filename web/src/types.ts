export type Status = 'todo' | 'in_progress' | 'done'

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
  claimer: string
  createdAt: string
}

export interface ProgressEntry {
  id: string
  taskId: string
  author: string
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
  createdAt: string
  updatedAt: string
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
  author: string
  createdAt: string
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
