import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Avatar, Button, Empty, Input, Popconfirm, Space, Tooltip, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, SendOutlined } from '@ant-design/icons'
import Md from '../Md'
import { api } from '../../api'
import { useKanban } from '../../store'
import type { Comment, User } from '../../types'
import { avatarStyle, fmtTime } from '../../lib'
import { WriteGuard } from './taskShared'

const { Text } = Typography

const MAX_LEN = 2000

/** 当前用户是否为评论作者（匿名时 userId 为空无法匹配——匿名回落账号仅 open 模式写，作者为 anonymous） */
function isMine(c: Comment, me: User | null): boolean {
  if (!me) return false
  if (c.userId) return c.userId === me.id
  return c.author === me.displayName
}

/** 评论区块：中栏。顶层评论 + 单层回复；列表滚动 + 输入框常驻底部 */
export function CommentsSection({
  taskId,
  user,
  writable,
}: {
  taskId: string
  user: User | null
  writable: boolean
}) {
  const { message } = App.useApp()
  const isAdminUser = useKanban((s) => s.user)?.role === 'admin'
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [replyTo, setReplyTo] = useState<string | null>(null) // 回复的顶层评论 id
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  // 任务切换时拉取
  useEffect(() => {
    let alive = true
    setComments(null)
    setReplyTo(null)
    setEditingId(null)
    setDraft('')
    api
      .listComments(taskId)
      .then((cs) => {
        if (alive) setComments(cs)
      })
      .catch(() => {
        if (alive) setComments([])
      })
    return () => {
      alive = false
    }
  }, [taskId])

  const topLevel = useMemo(() => (comments ?? []).filter((c) => !c.parentId), [comments])
  const repliesOf = useCallback(
    (pid: string) => (comments ?? []).filter((c) => c.parentId === pid),
    [comments],
  )

  const submit = async () => {
    const content = draft.trim()
    if (!content) return
    setSending(true)
    try {
      const created = await api.addComment(taskId, content, replyTo ?? undefined)
      setComments((prev) => [...(prev ?? []), created])
      setDraft('')
      setReplyTo(null)
      message.success(replyTo ? '回复成功' : '评论成功')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const saveEdit = async (id: string) => {
    const content = draft.trim()
    if (!content) return
    setSending(true)
    try {
      const updated = await api.updateComment(id, content)
      setComments((prev) => (prev ?? []).map((c) => (c.id === id ? updated : c)))
      setEditingId(null)
      setDraft('')
      message.success('已更新')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await api.deleteComment(id)
      // 顶层删除 → 其后代（回复）一并消失
      setComments((prev) => {
        const target = (prev ?? []).find((c) => c.id === id)
        return (prev ?? []).filter((c) => c.id !== id && !(target && c.parentId === target.id))
      })
      if (editingId === id) setEditingId(null)
      message.success('已删除')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const startEdit = (c: Comment) => {
    setEditingId(c.id)
    setDraft(c.content)
  }

  const canDelete = (c: Comment) => isMine(c, user) || isAdminUser
  const canEdit = (c: Comment) => isMine(c, user)

  const renderComment = (c: Comment, isReply: boolean) => {
    const mine = isMine(c, user)
    return (
      <div
        key={c.id}
        style={{
          display: 'flex',
          gap: 8,
          padding: isReply ? '6px 0 6px 14px' : '8px 0',
          borderLeft: isReply ? '2px solid rgba(79,110,247,0.2)' : undefined,
          marginLeft: isReply ? 6 : undefined,
        }}
      >
        <Avatar size={isReply ? 20 : 26} style={avatarStyle(c.author)}>
          {c.author.slice(0, 1).toUpperCase()}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text strong style={{ fontSize: 12 }}>
              {c.author}
              {mine && '（我）'}
            </Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {fmtTime(c.createdAt)}
            </Text>
            {c.updatedAt !== c.createdAt && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                · 已编辑
              </Text>
            )}
            <Space size={0} style={{ marginLeft: 'auto' }}>
              <Tooltip title={isReply ? '回复此评论' : '回复'}>
                <Button
                  size="small"
                  type="text"
                  icon={<SendOutlined />}
                  disabled={!writable}
                  onClick={() => {
                    // 回复目标归一为顶层
                    const topId = c.parentId || c.id
                    setReplyTo(topId)
                    setEditingId(null)
                  }}
                />
              </Tooltip>
              {canEdit(c) && (
                <Tooltip title="编辑">
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setReplyTo(null)
                      startEdit(c)
                    }}
                  />
                </Tooltip>
              )}
              {canDelete(c) && (
                <Popconfirm
                  title="删除这条评论？"
                  description={c.parentId ? '删除该回复' : '删除评论及其全部回复'}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => remove(c.id)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </Space>
          </div>
          {editingId === c.id ? (
            <div style={{ marginTop: 6 }}>
              <Input.TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 5 }}
                autoFocus
                maxLength={MAX_LEN}
              />
              <Space style={{ marginTop: 6 }}>
                <Button
                  type="primary"
                  size="small"
                  loading={sending}
                  disabled={!draft.trim()}
                  onClick={() => saveEdit(c.id)}
                >
                  保存
                </Button>
                <Button size="small" onClick={() => { setEditingId(null); setDraft('') }}>
                  取消
                </Button>
              </Space>
            </div>
          ) : (
            <div style={{ fontSize: 13, marginTop: 2 }}>
              <Md>{c.content}</Md>
            </div>
          )}
          {/* 顶层评论下的回复（该顶层自身编辑中时折叠，避免编辑框与回复错乱） */}
          {!isReply &&
            editingId !== c.id &&
            repliesOf(c.id).map((r) => renderComment(r, true))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* 评论列表：超高内部滚动 */}
      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: 4 }}>
        {comments === null ? (
          <div style={{ padding: '24px 0' }}>
            <Input.TextArea disabled placeholder="加载中..." style={{ height: 60 }} />
          </div>
        ) : topLevel.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有评论，发一条开启讨论吧" />
        ) : (
          topLevel.map((c) => renderComment(c, false))
        )}
      </div>

      {/* 回复目标提示 */}
      {replyTo && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: 'rgba(79,110,247,0.9)',
            marginTop: 8,
            background: 'rgba(79,110,247,0.05)',
            borderRadius: 6,
            padding: '4px 8px',
            flexShrink: 0,
          }}
        >
          <SendOutlined />
          <Text style={{ fontSize: 12 }}>回复 {comments?.find((c) => c.id === replyTo)?.author ?? ''}</Text>
          <Button
            size="small"
            type="text"
            onClick={() => setReplyTo(null)}
            style={{ marginLeft: 'auto', fontSize: 12 }}
          >
            取消
          </Button>
        </div>
      )}

      {/* 输入框：常驻底部 */}
      {writable ? (
        <div style={{ marginTop: 8, flexShrink: 0 }}>
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={replyTo ? '写回复...' : '写评论...（支持 Markdown）'}
            maxLength={MAX_LEN}
            style={{ fontSize: 13 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={sending}
              disabled={!draft.trim() || editingId !== null}
              onClick={submit}
            >
              {replyTo ? '回复' : '评论'}
            </Button>
          </div>
        </div>
      ) : (
        <WriteGuard can={false} hint="只读模式，登录后可评论">
          <span />
        </WriteGuard>
      )}
    </div>
  )
}
