import { useCallback, useEffect, useState } from 'react'
import {
  App,
  Button,
  Empty,
  List,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { ClockCircleOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useKanban } from '../store'
import { useUI } from '../ui'
import type { Status, Task } from '../types'
import { statusMeta, fmtTime } from '../lib'

const { Text } = Typography

/** 回收站：软删任务列表，支持恢复 / 彻底删除（admin 或创建者） */
export default function TrashPage() {
  const { message } = App.useApp()
  const user = useKanban((s) => s.user)
  const openTask = useUI((s) => s.openTask)
  const [items, setItems] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await api.listTrash())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (key: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(key)
    try {
      await fn()
      message.success(okMsg)
      await load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const restore = (id: string) => void run(id + '-r', () => api.restoreTrash(id), '已恢复到看板')
  const purge = (id: string) => void run(id + '-p', () => api.purgeTrash(id), '已彻底删除')

  const canPurge = (t: Task) => !!user && (user.role === 'admin' || user.id === t.createdBy)

  const [statusFilter, setStatusFilter] = useState<string>('all')

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          回收站
        </Typography.Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          已删除的任务可在此恢复；彻底删除不可撤销。
        </Text>
        <div style={{ flex: 1 }} />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 130 }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'todo', label: '待认领' },
            { value: 'in_progress', label: '进行中' },
            { value: 'done', label: '已完成' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>

      {items.length === 0 ? (
        <Empty description="回收站是空的" style={{ margin: 'auto' }} />
      ) : (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <List
            dataSource={items.filter((t) => statusFilter === 'all' || t.status === (statusFilter as Status))}
            renderItem={(t) => (
              <List.Item
                actions={[
                  <Popconfirm
                    key="restore"
                    title="恢复到看板？"
                    okText="恢复"
                    cancelText="取消"
                    onConfirm={() => void restore(t.id)}
                  >
                    <Button size="small" type="primary" ghost icon={<ReloadOutlined />} loading={busy === t.id + '-r'}>
                      恢复
                    </Button>
                  </Popconfirm>,
                  <Popconfirm
                    key="purge"
                    title="彻底删除该任务？"
                    description="将物理删除任务及其认领、进度、依赖记录，不可恢复！"
                    okText="彻底删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    disabled={!canPurge(t)}
                    onConfirm={() => void purge(t.id)}
                  >
                    <Button
                      size="small"
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      disabled={!canPurge(t)}
                      loading={busy === t.id + '-p'}
                    >
                      彻底删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8} wrap>
                      <Tag color={statusMeta[t.status].antdColor} style={{ marginInlineEnd: 0 }}>
                        {statusMeta[t.status].label}
                      </Tag>
                      <Typography.Text
                        strong
                        style={{ cursor: 'pointer' }}
                        onClick={() => openTask(t.id)}
                      >
                        {t.title}
                      </Typography.Text>
                      {!canPurge(t) && (
                        <Tooltip title="仅任务创建者或管理员可彻底删除">
                          <Tag style={{ marginInlineEnd: 0 }}>他人任务</Tag>
                        </Tooltip>
                      )}
                    </Space>
                  }
                  description={
                    <Space size={8} wrap style={{ marginTop: 2 }}>
                      {t.createdByName && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          创建人：{t.createdByName}
                        </Text>
                      )}
                      {t.dueDate && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          <ClockCircleOutlined style={{ marginRight: 3 }} />
                          截止 {t.dueDate}
                        </Text>
                      )}
                      {t.deletedAt && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          删除于 {fmtTime(t.deletedAt)}
                        </Text>
                      )}
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      )}
    </div>
  )
}
