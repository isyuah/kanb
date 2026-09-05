import { useEffect, useRef, useState } from 'react'
import { App, Button, Input, Modal, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import Md from '../Md'
import { useKanban } from '../../store'
import type { Task } from '../../types'

const { Text } = Typography

/** 任务内容编辑：预览卡片 + 全屏 Markdown 双栏编辑弹窗 */
export function ContentSection({
  task,
  editable,
  onChanged,
}: {
  task: Task
  editable: boolean
  onChanged: () => void
}) {
  const { message } = App.useApp()
  const patchTask = useKanban((s) => s.patchTask)
  const [modalOpen, setModalOpen] = useState(false)
  const [draft, setDraft] = useState(task.content)

  useEffect(() => {
    setDraft(task.content)
  }, [task.content, task.id])

  const open = () => {
    if (!editable) return
    setDraft(task.content)
    setModalOpen(true)
  }

  const save = async () => {
    try {
      await patchTask(task.id, { content: draft })
      onChanged()
      setModalOpen(false)
      message.success('已保存内容')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <div>
      {task.content ? (
        <div onClick={open} title={editable ? '点击全屏编辑' : '仅创建者或管理员可编辑'}>
          <ContentPreview content={task.content} onClick={editable ? open : undefined} />
        </div>
      ) : editable ? (
        <Button type="dashed" block icon={<PlusOutlined />} onClick={open}>
          添加任务内容（支持 Markdown）
        </Button>
      ) : (
        <Text type="secondary" style={{ fontSize: 13 }}>
          仅创建者或管理员可编辑内容
        </Text>
      )}

      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={save}
        okText="保存"
        cancelText="取消"
        width={860}
        title={`编辑内容 — ${task.title}`}
        destroyOnHidden
        style={{ top: 32 }}
        styles={{
          body: { maxHeight: 'calc(100vh - 220px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
        }}
      >
        <div style={{ display: 'flex', gap: 12, height: '100%', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 6 }}>
              Markdown 编辑
            </Text>
            <Input.TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoSize={false}
              autoFocus
              placeholder={"支持 **加粗**、`代码`、列表、标题、表格等 Markdown 语法"}
              style={{
                flex: 1,
                fontFamily: 'Cascadia Code, Consolas, monospace',
                fontSize: 13,
                resize: 'none',
                minHeight: 280,
              }}
            />
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflowY: 'auto',
              border: '1px solid rgba(31,36,48,0.08)',
              borderRadius: 8,
              padding: '10px 14px',
            }}
          >
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 6, display: 'block' }}>
              预览
            </Text>
            {draft ? <Md>{draft}</Md> : <Text type="secondary">预览区</Text>}
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** 内容预览：仅内容溢出容器时才显示底部渐隐，避免短内容被遮罩盖住 */
export function ContentPreview({ content, onClick }: { content: string; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 4)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [content])

  return (
    <div
      ref={ref}
      style={{ cursor: onClick ? 'pointer' : 'default', maxHeight: 220, overflow: 'hidden', position: 'relative' }}
      onClick={onClick}
      title={onClick ? '点击全屏编辑' : ''}
    >
      <Md>{content}</Md>
      {overflowing && (
        <div
          style={{
            position: 'absolute',
            inset: 'auto 0 0 0',
            height: 56,
            background: 'linear-gradient(transparent, #fff)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
