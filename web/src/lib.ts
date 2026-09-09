import type { CSSProperties } from 'react'
import dayjs from 'dayjs'
import type { Task, User } from './types'
import { isClosed } from './status'

/** Deterministic pleasant color for a name. */
const PALETTE = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96',
  '#13c2c2', '#f5222d', '#2f54eb', '#a0d911', '#fa541c',
]

export function hashHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}

export function nameColor(name: string): string {
  // pick from a fixed palette by hash for consistency
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export const avatarStyle = (name: string): CSSProperties => ({
  background: nameColor(name),
})

/** Overall completion percent for a task: average of claimer progress, or 0. */
export function taskPercent(t: Task): number {
  if (!t.progress || t.progress.length === 0) return 0
  const sum = t.progress.reduce((acc, p) => acc + p.percent, 0)
  return Math.round(sum / t.progress.length)
}

export function fmtTime(iso: string): string {
  return dayjs(iso).format('MM-DD HH:mm')
}

export function fmtDate(d: string): string {
  return dayjs(d).format('MM-DD')
}

export function isOverdue(t: Task): boolean {
  if (!t.dueDate || isClosed(t.status)) return false
  return dayjs(t.dueDate).isBefore(dayjs(), 'day')
}

export function daysLeft(t: Task): number {
  if (!t.dueDate) return 0
  return dayjs(t.dueDate).diff(dayjs(), 'day')
}

export function isBlocked(t: Task): boolean {
  return t.deps.some((d) => !isClosed(d.status))
}

/** 任务是否属于当前用户认领（优先 userId，兜底按认领人名匹配） */
export function isMine(t: Task, me: User | null): boolean {
  if (!me) return false
  if (t.claims.some((c) => c.userId === me.id)) return true
  return t.claims.some((c) => c.userId == null && c.claimer === me.displayName)
}
