import { Avatar, Drawer, Empty, Timeline, Typography } from 'antd'
import { useKanban } from '../store'
import { useUI } from '../ui'
import { ACTION_LABELS } from '../types'
import { avatarStyle, fmtTime } from '../lib'

const { Text } = Typography

export default function FeedDrawer() {
  const open = useUI((s) => s.feedOpen)
  const setOpen = useUI((s) => s.setFeedOpen)
  const activities = useKanban((s) => s.activities)
  const tasks = useKanban((s) => s.tasks)
  const openTask = useUI((s) => s.openTask)

  const resolveTitle = (taskId: string) => {
    const t = tasks.find((x) => x.id === taskId)
    return t?.title ?? '已删除的任务'
  }

  return (
    <Drawer
      open={open}
      onClose={() => setOpen(false)}
      title="团队动态"
      width={440}
      destroyOnHidden
    >
      {activities.length === 0 ? (
        <Empty description="还没有操作记录" />
      ) : (
        <Timeline
          items={activities.map((a) => ({
            color: a.author ? '#4f6ef7' : 'gray',
            children: (
              <div key={a.id} style={{ paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar size={22} style={avatarStyle(a.author || '系统')}>
                    {(a.author || '系').slice(0, 1).toUpperCase()}
                  </Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13 }}>
                      {a.author || '系统'}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      {ACTION_LABELS[a.action] ?? a.action}
                    </Text>
                  </div>
                </div>
                {a.targetId && a.action !== 'deleted' && (
                  <div style={{ margin: '4px 0 0 30px' }}>
                    <Text
                      style={{ fontSize: 13, cursor: 'pointer' }}
                      onClick={() => {
                        const t = tasks.find((x) => x.id === a.targetId)
                        if (t) {
                          setOpen(false)
                          openTask(t.id)
                        }
                      }}
                    >
                      {a.taskTitle || resolveTitle(a.targetId)}
                    </Text>
                  </div>
                )}
                <div style={{ margin: '2px 0 0 30px' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {fmtTime(a.createdAt)}
                  </Text>
                </div>
              </div>
            ),
          }))}
        />
      )}
    </Drawer>
  )
}
