import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App,
  Avatar,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Modal,
  Skeleton,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Slider,
  Space,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd'
import {
  CheckOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FlagOutlined,
  InboxOutlined,
  LinkOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import Md from './Md'
import { useKanban, usePerms } from '../store'
import { useUI } from '../ui'
import type { Claim, ProgressEntry, Status, Task, User } from '../types'
import { ACTION_LABELS } from '../types'
import { avatarStyle, fmtTime } from '../lib'

const { Text } = Typography

/** 认领归属：优先 userId，兜底按认领人名匹配 */
function claimIsMine(c: Claim, me: User | null): boolean {
  if (!me) return false
  if (c.userId) return c.userId === me.id
  return c.claimer === me.displayName
}
/** 进度记录归属（本人可编辑/删除） */
function entryIsMine(p: ProgressEntry, me: User | null): boolean {
  if (!me) return false
  if (p.userId) return p.userId === me.id
  return p.author === me.displayName
}

export default function TaskDrawer() {
  const open = useUI((s) => s.drawerOpen)
  const id = useUI((s) => s.selectedId)
  const close = useUI((s) => s.closeTask)
  const tasks = useKanban((s) => s.tasks)
  const commit = useKanban((s) => s.commit)
  const { user, writable } = usePerms()

  const task = id ? (tasks.find((t) => t.id === id) ?? null) : null

  return (
    <Drawer
      open={open}
      onClose={close}
      width={620}
      title={null}
      destroyOnHidden
      styles={{ body: { padding: 0 } }}
      mask={{ closable: true }}
    >
      {task ? (
        <TaskDetail task={task} user={user} writable={writable} onChanged={() => void commit()} />
      ) : (
        <div style={{ padding: 40 }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      )}
    </Drawer>
  )
}

function TaskDetail({
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
  const patchTask = useKanban((s) => s.patchTask)
  const deleteTask = useKanban((s) => s.deleteTask)
  const archiveTask = useKanban((s) => s.archiveTask)
  const claimTask = useKanban((s) => s.claimTask)
  const unclaimTask = useKanban((s) => s.unclaimTask)

  const claimed = task.claims.some((c) => claimIsMine(c, user))
  const blockedBy = task.deps.filter((d) => d.status !== 'done')
  const deletable = writable
  const editable = writable
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const activities = useKanban((s) => s.activities)
  const myActs = useMemo(() => activities.filter((a) => a.targetId === task.id), [activities, task.id])

  useEffect(() => {
    setTitleDraft(task.title)
    setEditTitle(false)
  }, [task.id, task.title])

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      await fn()
      if (okMsg) message.success(okMsg)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const saveTitle = async () => {
    const t = titleDraft.trim()
    if (!t || t === task.title) {
      setEditTitle(false)
      return
    }
    await act(async () => patchTask(task.id, { title: t }))
    setEditTitle(false)
  }

  const noWriteHint = !writable ? '只读模式，登录后可操作' : !editable ? '仅创建者或管理员可修改' : ''

  return (
    <div>
      <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid rgba(31,36,48,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Tag color={statusColor(task.status)} style={{ marginInlineEnd: 0 }}>
            {statusLabel(task.status)}
          </Tag>
          {task.tags.map((t) => (
            <Tag key={t} style={{ marginInlineEnd: 0 }}>
              {t}
            </Tag>
          ))}
          {task.dueDate && (
            <Tag icon={<ClockCircleOutlined />} color="warning" style={{ marginInlineEnd: 0 }}>
              {task.dueDate}
            </Tag>
          )}
          {task.createdByName && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              创建：{task.createdByName}
            </Text>
          )}
          <div style={{ flex: 1 }} />
          <WriteGuard can={editable && writable} hint={noWriteHint}>
            <Popconfirm
              title="归档任务"
              description="归档后从看板隐藏，可在归档中查看或恢复，确定？"
              okText="归档"
              cancelText="取消"
              onConfirm={() =>
                act(async () => {
                  await archiveTask(task.id, true)
                  useUI.getState().closeTask()
                }, '已归档')
              }
            >
              <Button size="small" type="text" icon={<InboxOutlined />}>
                归档
              </Button>
            </Popconfirm>
          </WriteGuard>
          <WriteGuard can={deletable && writable} hint={noWriteHint || (deletable ? '' : '仅创建者或管理员可删除')}>
            <Popconfirm
              title="删除任务"
              description="将任务移入回收站，可恢复；彻底删除需在回收站操作。"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() =>
                act(async () => {
                  await deleteTask(task.id)
                  useUI.getState().closeTask()
                }, '已移入回收站')
              }
            >
              <Button size="small" danger type="text" icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </WriteGuard>
        </div>

        <div style={{ marginTop: 10 }}>
          {editTitle ? (
            <Input.TextArea
              autoSize={{ minRows: 1, maxRows: 3 }}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onPressEnter={() => void saveTitle()}
              autoFocus
              style={{ fontWeight: 700, fontSize: 18 }}
            />
          ) : (
            <Typography.Title
              level={4}
              style={{ margin: 0, cursor: editable && writable ? 'pointer' : 'default' }}
              onClick={() => {
                if (editable && writable) {
                  setTitleDraft(task.title)
                  setEditTitle(true)
                }
              }}
            >
              {task.title}
              {editable && writable && (
                <EditOutlined style={{ fontSize: 14, color: 'rgba(31,36,48,0.25)', marginLeft: 10 }} />
              )}
            </Typography.Title>
          )}
        </div>

        {blockedBy.length > 0 && (
          <Alert type="warning" showIcon style={{ marginTop: 12 }} message={`等待 ${blockedBy.length} 个前置任务完成`} />
        )}

        <Space style={{ marginTop: 12, width: '100%' }} wrap>
          {claimed ? (
            <Button
              icon={<CheckOutlined />}
              onClick={() => act(async () => unclaimTask(task.id), '已取消认领')}
            >
              我已认领
            </Button>
          ) : (
            <WriteGuard can={writable} hint={noWriteHint}>
              <Button
                type="primary"
                icon={<UserAddOutlined />}
                disabled={!writable}
                onClick={() => act(async () => claimTask(task.id), '认领成功')}
              >
                认领任务
              </Button>
            </WriteGuard>
          )}
          <WriteGuard can={writable} hint={noWriteHint}>
            <Segmented
              value={task.status}
              disabled={!writable}
              onChange={(v) => act(async () => patchTask(task.id, { status: v as Status }))}
              options={[
                { value: 'todo', label: '待认领' },
                { value: 'in_progress', label: '进行中' },
                { value: 'done', label: '已完成' },
              ]}
            />
          </WriteGuard>
          <div style={{ flex: 1 }} />
          <WriteGuard can={writable} hint={noWriteHint}>
            <DatePicker
              value={task.dueDate ? dayjs(task.dueDate) : null}
              disabled={!writable}
              onChange={(d) =>
                act(async () => patchTask(task.id, { dueDate: d ? d.format('YYYY-MM-DD') : null }))
              }
              placeholder="截止日期"
              allowClear
            />
          </WriteGuard>
        </Space>
      </div>

      <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(31,36,48,0.06)' }}>
        <SectionTitle icon={<FlagOutlined />} title="认领人" />
        {task.claims.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 13 }}>
            暂无人认领
          </Text>
        ) : (
          <Space wrap size={[8, 8]} style={{ marginTop: 8 }}>
            {task.claims.map((c) => (
              <Tag
                key={c.id}
                closable={writable && claimIsMine(c, user)}
                onClose={() => act(async () => unclaimTask(task.id))}
                style={{ padding: '3px 10px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Avatar size={18} style={avatarStyle(c.claimer)}>
                  {c.claimer.slice(0, 1).toUpperCase()}
                </Avatar>
                {c.claimer}
                {claimIsMine(c, user) && '（我）'}
              </Tag>
            ))}
          </Space>
        )}
      </div>

      <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(31,36,48,0.06)' }}>
        <SectionTitle icon={<EditOutlined />} title="任务内容" />
        <ContentEditor task={task} editable={editable && writable} onChanged={onChanged} />
      </div>

      <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(31,36,48,0.06)' }}>
        <SectionTitle icon={<LinkOutlined />} title="依赖" />
        <DepsSection task={task} writable={writable} onChanged={onChanged} />
      </div>

      <div style={{ padding: '16px 24px 24px' }}>
        <SectionTitle icon={<ReloadOutlined />} title="进度记录" />
        <ProgressFeed task={task} user={user} writable={writable} onChanged={onChanged} />
      </div>

      <div style={{ padding: '16px 24px 24px', borderTop: '1px solid rgba(31,36,48,0.06)' }}>
        <SectionTitle icon={<ClockCircleOutlined />} title="操作时间线" />
        {myActs.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 13 }}>
            暂无操作记录
          </Text>
        ) : (
          <Timeline
            items={myActs.slice(0, 12).map((a) => {
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
    </div>
  )
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
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
function WriteGuard({ can, hint, children }: { can: boolean; hint: string; children: React.ReactElement }) {
  if (can) return children
  return (
    <Tooltip title={hint}>
      <span style={{ display: 'inline-flex' }}>{children}</span>
    </Tooltip>
  )
}

function ContentEditor({
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
function ContentPreview({ content, onClick }: { content: string; onClick?: () => void }) {
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

function DepsSection({
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <Text type="secondary" style={{ fontSize: 13, paddingBottom: 4 }}>
            没有前置依赖
          </Text>
        </div>
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
          <Button type="dashed" size="small" icon={<PlusOutlined />} style={{ marginTop: 8 }} onClick={() => setAdding(true)}>
            添加依赖
          </Button>
        )
      )}
    </div>
  )
}

function ProgressFeed({
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
  const [adding, setAdding] = useState(false)
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
      setAdding(false)
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
    <div>
      {all.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={user ? '还没有进度记录，认领后添加第一条吧' : '还没有进度记录'} />
      ) : (
        <Timeline
          items={all.map((p) => {
            const mine = entryIsMine(p, user)
            return {
              color: mine ? '#4f6ef7' : 'gray',
              children: (
                <div style={{ paddingBottom: 6 }}>
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
                    <div style={{ marginTop: 4, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
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
              ),
            }
          })}
        />
      )}

      {!adding && editingId === null && (
        <WriteGuard can={writable} hint="只读模式，登录后可操作">
          <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 4 }} disabled={!writable} onClick={() => setAdding(true)}>
            添加进度记录
          </Button>
        </WriteGuard>
      )}
      {adding && (
        <div style={{ marginTop: 8, padding: 12, background: 'rgba(79,110,247,0.04)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Progress type="circle" percent={percent ?? 0} size={48} format={(v) => `${v}%`} />
            <Space direction="vertical" size={4} style={{ flex: 1 }}>
              <Slider value={percent ?? 0} onChange={setPercent} min={0} max={100} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                拖动调整完成百分比
              </Text>
            </Space>
          </div>
          <Input.TextArea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoSize={{ minRows: 2 }}
            placeholder="本次进展说明（可选，但建议填写）"
            style={{ marginTop: 8 }}
          />
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" size="small" icon={<SendOutlined />} onClick={submitAdd}>
              提交
            </Button>
            <Button size="small" onClick={() => { setAdding(false); setPercent(null); setText('') }}>
              取消
            </Button>
          </Space>
        </div>
      )}
    </div>
  )
}

function statusLabel(s: Status): string {
  return s === 'todo' ? '待认领' : s === 'in_progress' ? '进行中' : '已完成'
}
function statusColor(s: Status): string {
  return s === 'todo' ? 'default' : s === 'in_progress' ? 'processing' : 'success'
}
