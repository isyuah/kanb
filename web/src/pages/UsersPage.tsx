import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App,
  Avatar,
  Button,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
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
        width: 140,
        render: (_, u) => {
          const self = u.id === me?.id
          const lastAdmin = u.role === 'admin' && adminCount <= 1 && !u.disabled
          return u.disabled ? (
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
          )
        },
      },
    ]
    return colDefs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, me, adminCount])

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
          用户管理
        </Typography.Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          共 {users.length} 人，{adminCount} 名管理员；新成员可通过登录页自助注册（首个注册为管理员）
        </Text>
        <div style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table rowKey="id" size="middle" loading={loading} dataSource={users} columns={columns} pagination={false} />
      </div>
    </div>
  )
}
