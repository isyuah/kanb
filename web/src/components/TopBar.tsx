import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LogoutOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Avatar, Button, Dropdown, Input, Layout, Segmented, Space, Tag, Tooltip, Typography } from 'antd'
import { isAdmin, useKanban, usePerms } from '../store'
import { useUI, type Filter, type View } from '../ui'
import { avatarStyle, isOverdue } from '../lib'

const { Header } = Layout

const VIEW_OPTIONS: { value: View; label: string; icon: React.ReactNode }[] = [
  { value: 'board', label: '看板', icon: <AppstoreOutlined /> },
  { value: 'graph', label: '依赖图', icon: <ApartmentOutlined /> },
  { value: 'calendar', label: '日历', icon: <CalendarOutlined /> },
  { value: 'stats', label: '统计', icon: <BarChartOutlined /> },
  { value: 'report', label: '报表', icon: <FileTextOutlined /> },
]

export default function TopBar() {
  const user = useKanban((s) => s.user)
  const logout = useKanban((s) => s.logout)
  const tasks = useKanban((s) => s.tasks)
  const publicMode = useKanban((s) => s.publicMode)
  const registration = useKanban((s) => s.registration)
  const { writable } = usePerms()
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const filter = useUI((s) => s.filter)
  const setFilter = useUI((s) => s.setFilter)
  const setNewTaskOpen = useUI((s) => s.setNewTaskOpen)
  const setFeedOpen = useUI((s) => s.setFeedOpen)
  const setArchiveOpen = useUI((s) => s.setArchiveOpen)
  const setProfileOpen = useUI((s) => s.setProfileOpen)
  const setLoginOpen = useUI((s) => s.setLoginOpen)
  const query = useUI((s) => s.query)
  const setQuery = useUI((s) => s.setQuery)

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const overdueCount = tasks.filter((t) => isOverdue(t)).length
  const mineCount = user ? tasks.filter((t) => t.claims.some((c) => c.userId === user.id)).length : 0

  const displayName = user?.displayName ?? ''

  const userMenu = {
    items: [
      {
        key: 'profile',
        label: '个人中心',
        icon: <UserOutlined />,
      },
      ...(isAdmin(user)
        ? ([
            { type: 'divider' as const },
            { key: 'users', label: '用户管理', icon: <TeamOutlined /> },
            { key: 'settings', label: '系统设置', icon: <SettingOutlined /> },
          ] as const)
        : []),
      { type: 'divider' as const },
      { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'profile') setProfileOpen(true)
      else if (key === 'users') setView('users')
      else if (key === 'settings') setView('settings')
      else if (key === 'logout') {
        void logout()
        setView('board')
      }
    },
  }

  const onViewChange = (v: View) => {
    // 回收站/用户管理/设置等管理视图不允许 viewer 直达
    if (v === 'trash' || v === 'users' || v === 'settings') return
    setView(v)
  }

  return (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px 8px',
        borderBottom: '1px solid rgba(31,36,48,0.08)',
        paddingInline: 20,
        paddingBlock: 8,
        background: 'rgba(255,255,255,0.86)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        minHeight: 56,
        height: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <Typography.Title
          level={4}
          style={{ margin: 0, fontWeight: 800, letterSpacing: -0.5, cursor: 'pointer' }}
          onClick={() => setView('board')}
        >
          Kanb
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          团队任务看板
        </Typography.Text>
      </div>

      <Segmented
        value={view}
        onChange={(v) => onViewChange(v as View)}
        options={VIEW_OPTIONS}
      />

      {view !== 'board' ? null : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            allowClear
            prefix={<SearchOutlined style={{ color: 'rgba(31,36,48,0.4)' }} />}
            placeholder="搜索任务、标签、认领人"
            style={{ width: 'min(200px, 28vw)', marginLeft: 8, minWidth: 120 }}
          />

          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            size="middle"
            options={[
              { value: 'all', label: '全部' },
              { value: 'mine', label: `我的${user && mineCount > 0 ? ` ${mineCount}` : ''}` },
              { value: 'overdue', label: `逾期${overdueCount > 0 ? ` ${overdueCount}` : ''}` },
            ]}
            style={{ marginLeft: 8 }}
          />
        </>
      )}

      <div style={{ flex: 1 }} />

      <Space size={6}>
        {overdueCount > 0 && (
          <Tooltip title="存在已逾期且未完成的任务">
            <Tag color="error" style={{ marginInlineEnd: 0 }}>
              {overdueCount} 项逾期
            </Tag>
          </Tooltip>
        )}
        <Tooltip title={`${doneCount} 个任务已完成`}>
          <Tag
            icon={<CheckCircleOutlined />}
            color="success"
            style={{ marginInlineEnd: 0, cursor: 'default' }}
          >
            {doneCount} 完成
          </Tag>
        </Tooltip>
        <Tooltip title="操作动态">
          <Button type="text" icon={<BellOutlined />} onClick={() => setFeedOpen(true)} />
        </Tooltip>
        <Tooltip title="查看已归档任务">
          <Button type="text" onClick={() => setArchiveOpen(true)}>
            归档
          </Button>
        </Tooltip>
        {user && user.role !== 'viewer' && (
          <Tooltip title="查看已删除（回收站）任务">
            <Button type="text" icon={<DeleteOutlined />} onClick={() => setView('trash')}>
              回收站
            </Button>
          </Tooltip>
        )}
      </Space>

      {user ? (
        <Dropdown menu={userMenu} trigger={['click']}>
          <Space style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 20 }}>
            <Avatar size={26} style={avatarStyle(displayName)}>
              {displayName.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography.Text
              strong
              style={{ maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {displayName}
            </Typography.Text>
          </Space>
        </Dropdown>
      ) : (
        <>
          <Button icon={<UserOutlined />} onClick={() => setLoginOpen(true)}>
            {registration === false ? '登 录' : '登录 / 注册'}
          </Button>
          {publicMode === 'readonly' || publicMode === 'open' ? (
            <Button onClick={() => setView('board')}>游客浏览</Button>
          ) : null}
        </>
      )}

      <Tooltip title={writable ? '' : user ? '你的角色为只读，无法创建任务' : publicMode === 'private' ? '请先登录' : '只读模式，登录后可创建任务'}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            if (!writable) {
              if (!user) setLoginOpen(true)
              return
            }
            setNewTaskOpen(true)
          }}
          disabled={view === 'trash' || view === 'users' || view === 'settings' || view === 'stats' || (!writable && !!user)}
        >
          新建任务
        </Button>
      </Tooltip>
    </Header>
  )
}
