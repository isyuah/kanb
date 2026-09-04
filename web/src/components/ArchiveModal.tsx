import { useEffect, useState } from 'react'
import { App, Button, Empty, List, Modal, Popconfirm, Space, Tag, Typography } from 'antd'
import { ClockCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useKanban } from '../store'
import { useUI } from '../ui'
import type { Task } from '../types'
import { fmtDate } from '../lib'

export default function ArchiveModal() {
  const open = useUI((s) => s.archiveOpen)
  const setOpen = useUI((s) => s.setArchiveOpen)
  const openTask = useUI((s) => s.openTask)
  const archiveTask = useKanban((s) => s.archiveTask)
  const commit = useKanban((s) => s.commit)
  const { message } = App.useApp()
  const [archived, setArchived] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setArchived(await api.listTasks(true))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const restore = async (id: string) => {
    await archiveTask(id, false)
    await commit()
    message.success('已恢复到看板')
    void load()
  }

  const archivedList = archived.filter((t) => t.archived)

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      title="归档任务"
      width={560}
      destroyOnHidden
    >
      <List
        loading={loading}
        dataSource={archivedList}
        locale={{ emptyText: <Empty description="暂无归档任务" /> }}
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
                <Button size="small" icon={<ReloadOutlined />} type="text">
                  恢复
                </Button>
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Typography.Text
                  strong
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setOpen(false)
                    openTask(t.id)
                  }}
                >
                  {t.title}
                </Typography.Text>
              }
              description={
                <Space size={8} wrap>
                  {t.dueDate && (
                    <Tag icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                      {fmtDate(t.dueDate)}
                    </Tag>
                  )}
                  {t.tags.map((tag) => (
                    <Tag key={tag} style={{ marginInlineEnd: 0 }}>
                      {tag}
                    </Tag>
                  ))}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    完成于 {t.status === 'done' ? '已完成' : t.status === 'in_progress' ? '进行中' : '待认领'}
                  </Typography.Text>
                </Space>
              }
            />
          </List.Item>
        )}
      />
    </Modal>
  )
}
