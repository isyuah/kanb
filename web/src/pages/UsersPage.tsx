import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App,
  Avatar,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import { KeyOutlined, ReloadOutlined, UserAddOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useKanban } from '../store'
import type { Role, User } from '../types'
import { ROLE_LABELS, ROLES } from '../types'
import { avatarStyle, fmtTime } from '../lib'

const { Text } = Typography

const ROLE_COLOR: Record<Role, string> = {
  admin: 'gold',
  member: 'blue',
  viewer: 'default',
}

export default function UsersPage() {
  const { message } = App.useApp()
  const me = useKanban((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [resetting, setResetting] = useState(false)
  const [createForm] = Form.useForm()
  const [resetForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  const setRole = async (u: User, role: Role) => {
    if (u.role === role) return
    if (u.id === me?.id) {
      message.warning('不能修改自己的角色')
      return
    }
    try {
      await api.setUserRole(u.id, role)
      message.success(`已将 ${u.displayName} 设为${ROLE_LABELS[role]}`)
      await load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const setDisabled = async (u: User, disabled: boolean) => {
    try {
      await api.setUserDisabled(u.id, disabled)
      message.success(disabled ? `已停用 ${u.displayName}` : `已启用 ${u.displayName}`)
      await load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const createUser = async (v: { username: string; password: string; displayName?: string }) => {
    setCreating(true)
    try {
      const u = await api.createUser({
        username: v.username.trim(),
        password: v.password,
        displayName: v.displayName?.trim() || undefined,
      })
      message.success(`已创建账号 @${u.username}（${ROLE_LABELS[u.role]}）`)
      setCreateOpen(false)
      createForm.resetFields()
      await load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const resetPassword = async (u: User, v: { password: string }) => {
    setResetting(true)
    try {
      await api.resetUserPassword(u.id, v.password)
      message.success(`已重置 ${u.displayName || u.username} 的密码，请将新密码告知对方`)
      setResetFor(null)
      resetForm.resetFields()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setResetting(false)
    }
  }

  const adminCount = users.filter((u) => u.role === 'admin' && !u.disabled).length

  const columns = useMemo(() => {
    const colDefs: {
      title: string
      dataIndex?: string
      key: string
      width?: number
      render?: (_: unknown, u: User) => React.ReactNode
    }[] = [
      {
        title: '用户',
        key: 'user',
        render: (_, u) => (
          <Space>
            <Avatar size={28} style={avatarStyle(u.displayName || u.username)}>
              {(u.displayName || u.username).slice(0, 1).toUpperCase()}
            </Avatar>
            <div>
              <Text strong>{u.displayName || u.username}</Text>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                @{u.username}
              </Text>
              <Tag color={ROLE_COLOR[u.role]} style={{ marginLeft: 6 }}>
                {ROLE_LABELS[u.role]}
              </Tag>
              {u.id === me?.id && (
                <Tag color="processing" style={{ marginLeft: 6 }}>
                  我
                </Tag>
              )}
            </div>
          </Space>
        ),
      },
      {
        title: '角色',
        key: 'role',
        width: 200,
        render: (_, u) => {
          const isLastAdmin = u.role === 'admin' && adminCount <= 1 && !u.disabled
          return (
            <Select
              size="small"
              value={u.role}
              disabled={u.id === me?.id || isLastAdmin}
              onChange={(r: Role) => void setRole(u, r)}
              options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              style={{ width: 110 }}
            />
          )
        },
      },
      {
        title: '状态',
        key: 'status',
        width: 100,
        render: (_, u) =>
          u.disabled ? <Tag color="error">已停用</Tag> : <Tag color="success">正常</Tag>,
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 160,
        render: (v: unknown) => fmtTime(v as string),
      },
      {
        title: '操作',
        key: 'ops',
        width: 210,
        render: (_, u) => {
          const self = u.id === me?.id
          const lastAdmin = u.role === 'admin' && adminCount <= 1 && !u.disabled
          return (
            <Space size={2}>
              <Tooltip title={self ? '修改自己的密码请到个人中心' : '设置一个新密码'}>
                <Button
                  size="small"
                  type="text"
                  icon={<KeyOutlined />}
                  disabled={self}
                  onClick={() => {
                    resetForm.resetFields()
                    setResetFor(u)
                  }}
                >
                  重置密码
                </Button>
              </Tooltip>
              {u.disabled ? (
                <Button size="small" type="text" disabled={self} onClick={() => void setDisabled(u, false)}>
                  启用
                </Button>
              ) : (
                <Popconfirm
                  title="停用该用户？"
                  description={self ? '不能停用自己' : '停用后无法登录与操作'}
                  okText="停用"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  disabled={self || lastAdmin}
                  onConfirm={() => void setDisabled(u, true)}
                >
                  <Button size="small" type="text" danger disabled={self || lastAdmin}>
                    停用
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )
        },
      },
    ]
    return colDefs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, me, adminCount, resetForm])

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          用户管理
        </Typography.Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          共 {users.length} 人，{adminCount} 名管理员；可代建账号、重置密码；开放注册见系统设置
        </Text>
        <div style={{ flex: 1 }} />
        <Button type="primary" icon={<UserAddOutlined />} onClick={() => setCreateOpen(true)}>
          新建用户
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table rowKey="id" size="middle" loading={loading} dataSource={users} columns={columns} pagination={false} />
      </div>

      {/* 新建用户（注册关闭时的加人通道） */}
      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
        confirmLoading={creating}
        onOk={() => createForm.submit()}
        destroyOnHidden
        maskClosable={false}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={(v) => void createUser(v)}
          style={{ marginTop: 8 }}
        >
          <Form.Item
            name="username"
            label="用户名（登录用）"
            rules={[
              { required: true, whitespace: true, message: '请输入用户名' },
              { pattern: /^\S+$/, message: '用户名不能含空格' },
            ]}
          >
            <Input placeholder="如 zhang.san" autoComplete="off" />
          </Form.Item>
          <Form.Item name="displayName" label="展示名（可选）">
            <Input placeholder="默认同用户名" maxLength={24} autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, message: '请输入初始密码' }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            创建后请将初始密码告知对方，对方登录后可在个人中心自行修改
          </Text>
        </Form>
      </Modal>

      {/* 重置密码（管理员自定义新密码） */}
      <Modal
        title={resetFor ? `重置密码：${resetFor.displayName || resetFor.username}（@${resetFor.username}）` : '重置密码'}
        open={!!resetFor}
        onCancel={() => setResetFor(null)}
        okText="重置"
        cancelText="取消"
        confirmLoading={resetting}
        onOk={() => resetForm.submit()}
        destroyOnHidden
        maskClosable={false}
      >
        <Form form={resetForm} layout="vertical" onFinish={(v) => resetFor && void resetPassword(resetFor, v)}>
          <Form.Item
            name="password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm"
            label="确认新密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  !value || getFieldValue('password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password placeholder="再次输入" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
