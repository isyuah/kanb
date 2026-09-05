import { useState } from 'react'
import { App, Avatar, Button, Empty, Input, Popconfirm, Progress, Slider, Space, Tooltip, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons'
import Md from '../Md'
import { useKanban } from '../../store'
import type { ProgressEntry, Task, User } from '../../types'
import { avatarStyle, fmtTime } from '../../lib'
import { entryIsMine, WriteGuard } from './taskShared'

const { Text } = Typography

/** 进度记录区块：认领人各自的百分比与说明（1:N 增改删） */
export function ProgressSection({
  task,
  user,
  writable,
  onChanged,
}: {
  task: Task
  user: User | null
  writable: boolean
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const addProgress = useKanban((s) => s.addProgress)
  const updateProgress = useKanban((s) => s.updateProgress)
  const deleteProgress = useKanban((s) => s.deleteProgress)

  const myEntries = task.progress.filter((p) => entryIsMine(p, user))
  const others = task.progress.filter((p) => !entryIsMine(p, user))
  const [percent, setPercent] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPercent, setEditPercent] = useState(0)
  const [editText, setEditText] = useState('')

  const startEdit = (p: ProgressEntry) => {
    setEditingId(p.id)
    setEditPercent(p.percent)
    setEditText(p.text)
  }

  const submitAdd = async () => {
    if (text.trim() === '' && (percent === null || percent === 0)) {
      message.warning('请填写进度说明或百分比')
      return
    }
    try {
      await addProgress(task.id, percent ?? 0, text.trim())
      onChanged()
      setPercent(null)
      setText('')
      message.success('已记录进度')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const submitEdit = async () => {
    if (!editingId) return
    try {
      await updateProgress(editingId, editPercent, editText.trim())
      onChanged()
      setEditingId(null)
      message.success('已更新')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const all = [...myEntries, ...others]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 记录列表：超高时内部滚动 */}
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: 4 }}>
        {all.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={user ? '还没有进度记录，认领后添加第一条吧' : '还没有进度记录'}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {all.map((p) => {
              const mine = entryIsMine(p, user)
              return (
                <div key={p.id} style={{ padding: '10px 12px', background: mine ? 'rgba(79,110,247,0.04)' : 'rgba(31,36,48,0.02)', borderRadius: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar size={20} style={avatarStyle(p.author)}>
                      {p.author.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Text strong style={{ fontSize: 13 }}>
                      {p.author}
                      {mine && '（我）'}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTime(p.updatedAt)}
                    </Text>
                    {mine && writable && (
                      <Space size={0} style={{ marginLeft: 'auto' }}>
                        <Tooltip title="编辑">
                          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => startEdit(p)} />
                        </Tooltip>
                        <Popconfirm
                          title="删除这条进度记录？"
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          cancelText="取消"
                          onConfirm={() => {
                            deleteProgress(p.id)
                              .then(onChanged)
                              .catch((e) => message.error((e as Error).message))
                          }}
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      </Space>
                    )}
                  </div>
                  {editingId === p.id ? (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Progress type="circle" percent={editPercent} size={44} format={(v) => `${v}%`} />
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={editPercent}
                          onChange={(e) => setEditPercent(Math.max(0, Math.min(100, Number(e.target.value))))}
                          style={{ width: 90 }}
                          addonAfter="%"
                        />
                      </div>
                      <Input.TextArea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoSize={{ minRows: 2 }}
                        style={{ marginTop: 8 }}
                      />
                      <Space style={{ marginTop: 8 }}>
                        <Button type="primary" size="small" icon={<SaveOutlined />} onClick={submitEdit}>
                          保存
                        </Button>
                        <Button size="small" onClick={() => setEditingId(null)}>
                          取消
                        </Button>
                      </Space>
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <Progress
                        type="circle"
                        percent={p.percent}
                        size={44}
                        strokeColor={p.percent === 100 ? '#2fbf71' : undefined}
                      />
                      {p.text && (
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Md>{p.text}</Md>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 添加进度：常驻底部，无需滚动即可新增 */}
      {writable && editingId === null && (
        <div style={{ marginTop: 10, padding: 12, background: 'rgba(79,110,247,0.05)', borderRadius: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Progress type="circle" percent={percent ?? 0} size={44} format={(v) => `${v}%`} />
            <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
              <Slider value={percent ?? 0} onChange={setPercent} min={0} max={100} />
            </Space>
          </div>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoSize={{ minRows: 1, maxRows: 3 }}
            placeholder="本次进展说明（可留空，仅报百分比）"
            style={{ marginTop: 8 }}
          />
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            style={{ marginTop: 8 }}
            onClick={submitAdd}
          >
            记录进度
          </Button>
        </div>
      )}
      {!writable && (
        <WriteGuard can={false} hint="只读模式，登录后可操作">
          <span />
        </WriteGuard>
      )}
    </div>
  )
}
