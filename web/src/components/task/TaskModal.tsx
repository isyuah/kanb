import { useEffect, useState } from 'react'
import {
  Alert,
  App,
  Avatar,
  Button,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  CheckOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  DeleteOutlined,
  EditOutlined,
  FlagOutlined,
  InboxOutlined,
  LinkOutlined,
  ReloadOutlined,
  UserAddOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '../../api'
import { useKanban, usePerms } from '../../store'
import { useUI } from '../../ui'
import type { Activity, Status, Task, User } from '../../types'
import { STATUS_ORDER, isClosed } from '../../status'
import { avatarStyle } from '../../lib'
import { claimIsMine, SectionTitle, statusColor, statusLabel, WriteGuard } from './taskShared'
import { ContentSection } from './ContentSection'
import { DepsSection } from './DepsSection'
import { ProgressSection } from './ProgressSection'
import { CommentsSection } from './CommentsSection'
import { ActivitySection } from './ActivitySection'

const { Text } = Typography

/** 任务详情弹窗：宽幅居中 Modal + 两栏布局（主内容区 / 元信息区） */
export default function TaskModal() {
  const open = useUI((s) => s.drawerOpen)
  const id = useUI((s) => s.selectedId)
  const close = useUI((s) => s.closeTask)
  const tasks = useKanban((s) => s.tasks)
  const commit = useKanban((s) => s.commit)
  const { user, writable } = usePerms()

  const task = id ? (tasks.find((t) => t.id === id) ?? null) : null

  return (
    <Modal
      open={open}
      onCancel={close}
      footer={null}
      width={1320}
      destroyOnHidden
      style={{ top: 24 }}
      styles={{
        body: {
          padding: 0,
          height: 'calc(100vh - 88px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
      }}
    >
      {task ? (
        <TaskDetailBody task={task} user={user} writable={writable} onChanged={() => void commit()} />
      ) : (
        <div style={{ padding: 40 }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </div>
      )}
    </Modal>
  )
}

function TaskDetailBody({
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
  const blockedBy = task.deps.filter((d) => !isClosed(d.status))
  const deletable = writable
  const editable = writable
  const [editTitle, setEditTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [taskActs, setTaskActs] = useState<Activity[] | null>(null)
  const activities = useKanban((s) => s.activities)

  // 打开/切换任务时按任务拉取完整时间线（初始空 → 显示加载，避免误报"暂无"）
  useEffect(() => {
    let alive = true
    setTaskActs(null)
    api
      .taskActivities(task.id)
      .then((acts) => {
        if (alive) setTaskActs(acts)
      })
      .catch(() => {
        if (alive) setTaskActs([])
      })
    return () => {
      alive = false
    }
  }, [task.id])

  // 全局活动刷新（写操作/SSE 后）时同步更新本任务时间线（增量拼接不去重简单覆盖）
  useEffect(() => {
    const mine = activities.filter((a) => a.targetId === task.id)
    if (mine.length > 0) {
      setTaskActs((prev) => {
        if (!prev) return mine
        const seen = new Set(prev.map((a) => a.id))
        return [...prev, ...mine.filter((a) => !seen.has(a.id))]
      })
    }
  }, [activities, task.id])

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* 顶部：状态/标签/截止 + 创建人 + 归档/删除 */}
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
              options={STATUS_ORDER.map((s) => ({ value: s, label: statusLabel(s) }))}
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

      {/* 主体三栏：左=内容/进度，中=评论，右=认领/依赖/时间线 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 5fr) minmax(300px, 4fr) minmax(0, 3fr)',
          gap: 0,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div
          style={{
            minWidth: 0,
            minHeight: 0,
            padding: '16px 24px',
            borderRight: '1px solid rgba(31,36,48,0.06)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SectionTitle icon={<EditOutlined />} title="任务内容" />
          <div style={{ overflowY: 'auto', minHeight: 0, flexShrink: 1 }}>
            <ContentSection task={task} editable={editable && writable} onChanged={onChanged} />
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <SectionTitle icon={<ReloadOutlined />} title="进度记录" />
            <ProgressSection task={task} user={user} writable={writable} onChanged={onChanged} />
          </div>
        </div>

        {/* 中栏：评论（列表滚动 + 输入常驻） */}
        <div
          style={{
            minWidth: 0,
            minHeight: 0,
            padding: '16px 20px',
            borderRight: '1px solid rgba(31,36,48,0.06)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SectionTitle icon={<CommentOutlined />} title="评论" />
          <CommentsSection taskId={task.id} user={user} writable={writable} />
        </div>

        <div
          style={{
            minWidth: 0,
            minHeight: 0,
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
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

          <div style={{ marginTop: 16 }}>
            <SectionTitle icon={<LinkOutlined />} title="依赖" />
            <DepsSection task={task} writable={writable} onChanged={onChanged} />
          </div>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <SectionTitle icon={<ClockCircleOutlined />} title="操作时间线" />
            <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
              {taskActs === null ? (
                <Skeleton active paragraph={{ rows: 3 }} />
              ) : (
                <ActivitySection user={user} myActs={taskActs} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
