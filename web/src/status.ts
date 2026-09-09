import type { Status } from './types'

/**
 * 状态注册表（单一来源）：状态展示文案/配色/顺序/终态语义全部收敛于此。
 * 后端对应 server/model.go 的 Status 常量与 http.go validStatus —— 新增状态需两侧同步。
 */
export interface StatusMeta {
  label: string
  /** 主色（列点/图表/节点边框等 hex） */
  accent: string
  /** antd Tag 预设色名或自定义 hex（自定义时 Tag 为填充白字） */
  antdColor: string
  /** 看板列底色 */
  columnBg: string
}

export const STATUS_META: Record<Status, StatusMeta> = {
  todo: {
    label: '待认领',
    accent: '#8c8c8c',
    antdColor: 'default',
    columnBg: 'rgba(140,140,140,0.08)',
  },
  in_progress: {
    label: '进行中',
    accent: '#4f6ef7',
    antdColor: 'processing',
    columnBg: 'rgba(79,110,247,0.08)',
  },
  done: {
    label: '已完成',
    accent: '#2fbf71',
    antdColor: 'success',
    columnBg: 'rgba(47,191,113,0.08)',
  },
  abandoned: {
    label: '已废弃',
    accent: '#b06a4f',
    antdColor: '#b06a4f',
    columnBg: 'rgba(176,106,79,0.08)',
  },
}

/** 看板列顺序：废弃为末列。 */
export const STATUS_ORDER: Status[] = ['todo', 'in_progress', 'done', 'abandoned']

/** 终态（完成/废弃）：不计逾期、不阻塞下游依赖、不可再选为依赖目标。 */
export function isClosed(s: Status): boolean {
  return s === 'done' || s === 'abandoned'
}

export function statusLabel(s: Status): string {
  return STATUS_META[s].label
}

export function statusColor(s: Status): string {
  return STATUS_META[s].antdColor
}

/** 未知状态码兜底：审计快照/历史数据里可能出现注册表外的值，直接展示原码。 */
export function statusLabelRaw(s: string): string {
  return (STATUS_META as Record<string, StatusMeta | undefined>)[s]?.label ?? s
}
