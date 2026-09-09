import { Tooltip, Typography } from 'antd'
import type { Claim, ProgressEntry, User } from '../../types'

const { Text } = Typography

/** 认领归属：优先 userId，兜底按认领人名匹配 */
export function claimIsMine(c: Claim, me: User | null): boolean {
  if (!me) return false
  if (c.userId) return c.userId === me.id
  return c.claimer === me.displayName
}
/** 进度记录归属（本人可编辑/删除） */
export function entryIsMine(p: ProgressEntry, me: User | null): boolean {
  if (!me) return false
  if (p.userId) return p.userId === me.id
  return p.author === me.displayName
}

// 状态文案/配色统一来自状态注册表（web/src/status.ts）
export { isClosed, statusColor, statusLabel } from '../../status'

export function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ color: 'rgba(79,110,247,0.9)' }}>{icon}</span>
      <Text strong style={{ fontSize: 14 }}>
        {title}
      </Text>
    </div>
  )
}

/** 写能力守卫：无权时禁用并提示 */
export function WriteGuard({ can, hint, children }: { can: boolean; hint: string; children: React.ReactElement }) {
  if (can) return children
  return (
    <Tooltip title={hint}>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
  )
}
