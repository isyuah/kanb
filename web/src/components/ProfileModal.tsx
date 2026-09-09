import { useMemo, useState } from 'react'
import {
  App,
  Avatar,
  Button,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import { EditOutlined, KeyOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useKanban } from '../store'
import { useUI } from '../ui'
import { ROLE_LABELS, ACTION_LABELS } from '../types'
import { STATUS_META } from '../status'
import { avatarStyle, fmtTime } from '../lib'

const { Text } = Typography

/** 个人中心：我的信息 / 我的认领 / 我的动态（宽 Modal 双列） */
export default function ProfileModal() {
  const open = useUI((s) => s.profileOpen)
  const setOpen = useUI((s) => s.setProfileOpen)
  const user = useKanban((s) => s.user)
  const tasks = useKanban((s) => s.tasks)
  const activities = useKanban((s) => s.activities)

  const mine = useMemo(() => {
    if (!user) return []
    return tasks.filter((t) => !t.archived && !t.deletedAt && t.claims.some((c) => c.userId === user.id))
  }, [tasks, user])

  const myActs = useMemo(() => {
    if (!user) return []
    return activities
      .filter((a) => {
        const name = a.authorName ?? a.author ?? null
        return a.userId === user.id || (!!name && name === user.displayName)
      })
      .slice(0, 60)
  }, [activities, user])

  if (!user) return null
  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      title="个人中心"
      width={960}
      destroyOnHidden
      style={{ top: 40 }}
      styles={{ body: { maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', paddingTop: 8 } }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 4fr)', gap: 32 }}>
        {/* 左列：我的信息 + 我的动态 */}
        <div style={{ minWidth: 0 }}>
          <ProfileSection
            user={user}
            setUser={(next) => {
              // 展示名更新后同步 store 与本地缓存（applyUser 已处理持久化）
              useKanban.getState().applyUser(next)
            }}
          />

          <div style={{ margin: '24px 0 10px' }}>
            <Text strong style={{ fontSize: 15 }}>
              我的动态
            </Text>
          </div>
          {myActs.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />
          ) : (
            <Timeline
              items={myActs.slice(0, 40).map((a) => ({
                color: '#4f6ef7',
                children: (
                  <div key={a.id}>
                    <Text strong style={{ fontSize: 13 }}>
                      {ACTION_LABELS[a.action] ?? a.action}
                    </Text>
                    {a.taskTitle && (
                      <Text type="secondary" style={{ fontSize: 13, marginLeft: 6 }}>
                        {a.taskTitle}
                      </Text>
                    )}
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {fmtTime(a.createdAt)}
                      </Text>
                    </div>
                  </div>
                ),
              }))}
            />
          )}
        </div>

        {/* 右列：我的认领 */}
        <div style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 15 }}>
            我的认领（{mine.length}）
          </Text>
          <div style={{ marginTop: 10 }}>
            {mine.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有认领任务" />
            ) : (
              <List
                size="small"
                dataSource={mine}
                renderItem={(t) => (
                  <List.Item
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setOpen(false)
                      useUI.getState().openTask(t.id)
                    }}
                  >
                    <List.Item.Meta
                      title={<Text strong style={{ fontSize: 13 }}>{t.title}</Text>}
                      description={
                        <Space size={6}>
                          <Tag style={{ marginInlineEnd: 0 }}>
                            {STATUS_META[t.status].label}
                          </Tag>
                          {t.dueDate && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              截止 {t.dueDate}
                            </Text>
                          )}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ProfileSection({
  user,
  setUser,
}: {
  user: NonNullable<ReturnType<typeof useKanban.getState>['user']>
  setUser: (u: typeof user) => void
}) {
  const { message } = App.useApp()
  const [editName, setEditName] = useState(false)
  const [nameDraft, setNameDraft] = useState(user.displayName)
  const [changePwd, setChangePwd] = useState(false)
  const [pwdForm] = Form.useForm()

  const saveName = async () => {
    const v = nameDraft.trim()
    if (!v || v === user.displayName) {
      setEditName(false)
      return
    }
    try {
      const u = await api.updateMe({ displayName: v })
      setUser(u)
      setEditName(false)
      message.success('展示名已更新')
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const savePwd = async (v: { oldPassword?: string; newPassword: string }) => {
    try {
      await api.updateMe({ oldPassword: v.oldPassword, password: v.newPassword })
      message.success('密码已更新')
      setChangePwd(false)
      pwdForm.resetFields()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Avatar size={56} style={avatarStyle(user.displayName)}>
          {user.displayName.slice(0, 1).toUpperCase()}
        </Avatar>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editName ? (
            <Space.Compact style={{ width: '100%', maxWidth: 260 }}>
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onPressEnter={() => void saveName()}
                maxLength={24}
                autoFocus
              />
              <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveName()}>
                保存
              </Button>
            </Space.Compact>
          ) : (
            <Space size={8}>
              <Text strong style={{ fontSize: 16 }}>
                {user.displayName}
              </Text>
              <Button
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => {
                  setNameDraft(user.displayName)
                  setEditName(true)
                }}
              />
            </Space>
          )}
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              @{user.username} · 角色：{ROLE_LABELS[user.role]}
            </Text>
          </div>
        </div>
      </div>

      <Descriptions
        size="small"
        column={1}
        style={{ marginTop: 12 }}
        items={[
          {
            key: 'role',
            label: '角色',
            children: (
              <Tag
                color={user.role === 'admin' ? 'gold' : user.role === 'member' ? 'blue' : 'default'}
              >
                {ROLE_LABELS[user.role]}
              </Tag>
            ),
          },
          { key: 'created', label: '加入时间', children: fmtTime(user.createdAt) },
        ]}
      />

      {changePwd ? (
        <Form
          form={pwdForm}
          layout="vertical"
          style={{ marginTop: 16 }}
          onFinish={(v) => void savePwd(v)}
        >
          <Form.Item name="oldPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="当前密码" />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 6, message: '至少 6 位' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="new-password" placeholder="至少 6 位" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Space>
              <Button type="primary" htmlType="submit" icon={<KeyOutlined />}>
                更新密码
              </Button>
              <Button onClick={() => setChangePwd(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      ) : (
        <Button icon={<KeyOutlined />} style={{ marginTop: 16 }} onClick={() => setChangePwd(true)}>
          修改密码
        </Button>
      )}
    </div>
  )
}
