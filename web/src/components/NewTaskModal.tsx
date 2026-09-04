import { useState } from 'react'
import { App, DatePicker, Input, Modal, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { useKanban, usePerms } from '../store'
import { useUI } from '../ui'

export default function NewTaskModal() {
  const open = useUI((s) => s.newTaskOpen)
  const setOpen = useUI((s) => s.setNewTaskOpen)
  const createTask = useKanban((s) => s.createTask)
  const { user: me } = usePerms()
  const { message } = App.useApp()

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [due, setDue] = useState<dayjs.Dayjs | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)

  const close = () => {
    setOpen(false)
    setTitle('')
    setContent('')
    setTags([])
    setDue(null)
    setTagInput('')
  }

  const submit = async () => {
    const t = title.trim()
    if (!t) {
      message.warning('请填写任务标题')
      return
    }
    if (!me && useKanban.getState().publicMode !== 'open') {
      message.warning('请先登录后再创建任务')
      return
    }
    setSaving(true)
    try {
      const task = await createTask({
        title: t,
        content: content.trim(),
        tags,
        dueDate: due ? due.format('YYYY-MM-DD') : null,
      })
      message.success('任务已创建')
      close()
      useUI.getState().openTask(task.id)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const onTagInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const v = tagInput.trim()
      if (v && !tags.includes(v)) setTags([...tags, v])
      setTagInput('')
    }
  }

  return (
    <Modal
      open={open}
      onCancel={close}
      onOk={submit}
      okText="创建任务"
      cancelText="取消"
      confirmLoading={saving}
      title="新建任务"
      width={520}
      destroyOnHidden
      mask={{ closable: true }}
    >
      <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
        <div>
          <Typography.Text strong>标题</Typography.Text>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="简明扼要的任务标题"
            autoFocus
            onPressEnter={submit}
            status={title.trim() ? undefined : 'warning'}
          />
        </div>
        <div>
          <Typography.Text strong>内容</Typography.Text>
          <Input.TextArea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="任务背景、目标、验收标准（可选）"
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Typography.Text strong>标签</Typography.Text>
            <div>
              {tags.map((t) => (
                <Tag
                  key={t}
                  closable
                  onClose={() => setTags(tags.filter((x) => x !== t))}
                  style={{ marginBottom: 4 }}
                >
                  {t}
                </Tag>
              ))}
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={onTagInput}
                placeholder="输入后回车添加"
                style={{ width: 140, marginTop: 4 }}
                disabled={tags.length >= 6}
              />
            </div>
          </div>
          <div>
            <Typography.Text strong>截止日期</Typography.Text>
            <div>
              <DatePicker
                value={due}
                onChange={setDue}
                style={{ width: '100%', marginTop: 4 }}
                placeholder="选择日期"
              />
            </div>
          </div>
        </div>
      </Space>
    </Modal>
  )
}
