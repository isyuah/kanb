import { useMemo, useState } from 'react'
import { Calendar, Empty, List, Space, Tag, Typography } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useKanban } from '../store'
import { useUI } from '../ui'
import { statusMeta } from '../lib'

const { Text } = Typography

/** 日历视图：按 dueDate 展示各任务截止日，点日期看当天任务 */
export default function CalendarPage() {
  const tasks = useKanban((s) => s.tasks)
  const openTask = useUI((s) => s.openTask)
  const [selected, setSelected] = useState<Dayjs>(() => dayjs())

  const byDate = useMemo(() => {
    const m = new Map<string, typeof tasks>()
    for (const t of tasks) {
      if (!t.dueDate || t.archived) continue
      const arr = m.get(t.dueDate) ?? []
      arr.push(t)
      m.set(t.dueDate, arr)
    }
    return m
  }, [tasks])

  const dayTasks = byDate.get(selected.format('YYYY-MM-DD')) ?? []

  const cellRender = (date: Dayjs, info: { type: string }) => {
    if (info.type !== 'date') return null
    const list = byDate.get(date.format('YYYY-MM-DD'))
    if (!list || list.length === 0) return null
    return (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {list.slice(0, 3).map((t) => (
          <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: statusMeta[t.status].accent,
                flexShrink: 0,
              }}
            />
            <Text
              ellipsis
              style={{ fontSize: 12, cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                openTask(t.id)
              }}
            >
              {t.title}
            </Text>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, background: '#fff', borderRadius: 14, padding: 12, overflow: 'auto' }}>
        <Calendar value={selected} onSelect={(d) => setSelected(d)} cellRender={cellRender} />
      </div>
      <div
        style={{
          width: 300,
          flexShrink: 0,
          background: '#fff',
          borderRadius: 14,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '100%',
          overflow: 'auto',
        }}
      >
        <Text strong style={{ marginBottom: 8 }}>
          截止 {selected.format('YYYY-MM-DD')}
          {dayTasks.length > 0 && `（${dayTasks.length}）`}
        </Text>
        {dayTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当天无截止任务" />
        ) : (
          <List
            size="small"
            dataSource={dayTasks}
            renderItem={(t) => {
              const over = t.status !== 'done' && dayjs(t.dueDate).isBefore(dayjs(), 'day')
              const meta = statusMeta[t.status]
              return (
                <List.Item style={{ cursor: 'pointer' }} onClick={() => openTask(t.id)}>
                  <div style={{ width: '100%' }}>
                    <Space size={6} style={{ marginBottom: 4 }}>
                      <Tag color={meta.antdColor} style={{ marginInlineEnd: 0, fontSize: 11 }}>
                        {meta.label}
                      </Tag>
                      {over && (
                        <Tag color="error" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                          已逾期
                        </Tag>
                      )}
                    </Space>
                    <div>
                      <Text strong style={{ fontSize: 13 }}>
                        {t.title}
                      </Text>
                    </div>
                    {t.claims.length > 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t.claims.map((c) => c.claimer).join('、')} 认领
                      </Text>
                    )}
                  </div>
                </List.Item>
              )
            }}
          />
        )}
      </div>
    </div>
  )
}
