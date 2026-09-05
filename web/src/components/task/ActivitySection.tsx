import { Timeline, Typography } from 'antd'
import type { Activity, User } from '../../types'
import { ACTION_LABELS } from '../../types'
import { fmtTime } from '../../lib'

const { Text } = Typography

/** 操作时间线内容（标题由调用方提供） */
export function ActivitySection({
  user,
  myActs,
}: {
  user: User | null
  myActs: Activity[]
}) {
  return (
    <div>
      {myActs.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 13 }}>
          暂无操作记录
        </Text>
      ) : (
        <Timeline
          items={myActs.map((a) => {
            const name = a.authorName ?? a.author ?? '系统'
            const mine = a.userId ? a.userId === user?.id : !!a.authorName && a.authorName === user?.displayName
            return {
              color: mine ? '#4f6ef7' : 'gray',
              children: (
                <div style={{ fontSize: 13 }}>
                  <Text strong>{name}</Text>
                  <Text type="secondary"> {ACTION_LABELS[a.action] ?? a.action}</Text>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTime(a.createdAt)}
                    </Text>
                  </div>
                </div>
              ),
            }
          })}
        />
      )}
    </div>
  )
}
