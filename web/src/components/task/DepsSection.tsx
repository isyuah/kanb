import { useMemo, useState } from 'react'
import { App, Button, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { LinkOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { useKanban } from '../../store'
import { useUI } from '../../ui'
import type { Task } from '../../types'
import { statusLabel } from './taskShared'

const { Text } = Typography

/** 依赖区块：前置任务列表 + 添加（防环已在后端校验） */
export function DepsSection({
  task,
  writable,
  onChanged,
}: {
  task: Task
  writable: boolean
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const tasks = useKanban((s) => s.tasks)
  const addDep = useKanban((s) => s.addDep)
  const removeDep = useKanban((s) => s.removeDep)
  const [adding, setAdding] = useState(false)
  const [depId, setDepId] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const existing = new Set(task.deps.map((d) => d.depId))
    return tasks.filter(
      (t) => t.id !== task.id && !existing.has(t.id) && !t.archived && t.status !== 'done',
    )
  }, [tasks, task])

  const add = async () => {
    if (!depId) return
    try {
      await addDep(task.id, depId)
      onChanged()
      setAdding(false)
      setDepId(null)
      message.success('已添加依赖')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <div>
      {task.deps.length === 0 ? (
        <Text type="secondary" style={{ fontSize: 13, display: 'block', paddingBottom: 4 }}>
          没有前置依赖
        </Text>
      ) : (
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {task.deps.map((d) => (
            <div
              key={d.depId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                background: d.status === 'done' ? 'rgba(47,191,113,0.06)' : 'rgba(31,36,48,0.03)',
                borderRadius: 8,
              }}
            >
              <Tag
                color={d.status === 'done' ? 'success' : 'default'}
                style={{ marginInlineEnd: 0, width: 56, textAlign: 'center' }}
              >
                {statusLabel(d.status)}
              </Tag>
              <Text
                strong
                style={{
                  fontSize: 13,
                  flex: 1,
                  textDecoration: d.status === 'done' ? 'line-through' : 'none',
                  opacity: d.status === 'done' ? 0.6 : 1,
                  cursor: 'pointer',
                }}
                onClick={() => useUI.getState().openTask(d.depId)}
              >
                {d.title}
              </Text>
              <Tooltip title="打开依赖任务">
                <Button
                  size="small"
                  type="text"
                  icon={<LinkOutlined />}
                  onClick={() => useUI.getState().openTask(d.depId)}
                />
              </Tooltip>
              {writable && (
                <Popconfirm
                  title="移除该依赖？"
                  okText="移除"
                  cancelText="取消"
                  onConfirm={() => {
                    removeDep(task.id, d.depId)
                      .then(() => { onChanged(); message.success('已移除依赖') })
                      .catch((e) => message.error((e as Error).message))
                  }}
                >
                  <Button size="small" type="text" danger icon={<MinusCircleOutlined />} />
                </Popconfirm>
              )}
            </div>
          ))}
        </Space>
      )}
      {adding ? (
        <Space.Compact style={{ marginTop: 10, width: '100%' }}>
          <Select
            showSearch
            placeholder="选择依赖任务"
            value={depId}
            onChange={setDepId}
            optionFilterProp="label"
            style={{ flex: 1 }}
            options={candidates.map((t) => ({ value: t.id, label: t.title }))}
            notFoundContent="没有可选任务"
            autoFocus
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={add} disabled={!depId}>
            添加
          </Button>
        </Space.Compact>
      ) : (
        writable &&
        candidates.length > 0 && (
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            style={{ marginTop: 8 }}
            onClick={() => setAdding(true)}
          >
            添加依赖
          </Button>
        )
      )}
    </div>
  )
}
