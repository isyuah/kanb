import { useState } from 'react'
import {
  Avatar,
  Button,
  Dropdown,
  Input,
  Layout,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BellOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useKanban } from '../store'
import { useUI, type Filter } from '../ui'
import { avatarStyle } from '../lib'

const { Header } = Layout

export default function TopBar() {
  const me = useKanban((s) => s.me)
  const setMe = useKanban((s) => s.setMe)
  const tasks = useKanban((s) => s.tasks)
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const filter = useUI((s) => s.filter)
  const setFilter = useUI((s) => s.setFilter)
  const setNewTaskOpen = useUI((s) => s.setNewTaskOpen)
  const setFeedOpen = useUI((s) => s.setFeedOpen)
  const setArchiveOpen = useUI((s) => s.setArchiveOpen)
  const query = useUI((s) => s.query)
  const setQuery = useUI((s) => s.setQuery)

  const [nameInput, setNameInput] = useState('')

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const overdueCount = tasks.filter(
    (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate).getTime() < Date.now(),
  ).length
  const mineCount = me ? tasks.filter((t) => t.claims.some((c) => c.claimer === me)).length : 0

  const commitName = () => {
    const n = nameInput.trim()
    if (n) {
      setMe(n)
      setNameInput('')
    }
  }

  const menu = {
    items: [
      {
        key: 'switch',
        label: (
          <Space>
            <UserOutlined />
            切换身份
          </Space>
        ),
      },
      { type: 'divider' as const },
      { key: 'guest', label: '以访客身份浏览（不记录操作）' },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'switch') {
        setMe('')
      } else if (key === 'guest') {
        setMe('')
      }
    },
  }

  return (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: '1px solid rgba(31,36,48,0.08)',
        paddingInline: 20,
        background: 'rgba(255,255,255,0.86)',
        backdropFilter: 'blur(10px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <Typography.Title level={4} style={{ margin: 0, fontWeight: 800, letterSpacing: -0.5 }}>
          Kanb
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          团队任务看板
        </Typography.Text>
      </div>

      <Segmented
        value={view}
        onChange={(v) => setView(v as 'board' | 'graph')}
        options={[
          { value: 'board', label: '看板', icon: <AppstoreOutlined /> },
          { value: 'graph', label: '依赖图', icon: <ApartmentOutlined /> },
        ]}
      />

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        allowClear
        prefix={<SearchOutlined style={{ color: 'rgba(31,36,48,0.4)' }} />}
        placeholder="搜索任务、标签、认领人"
        style={{ width: 220, marginLeft: 8 }}
      />

      <Segmented
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        size="middle"
        options={[
          { value: 'all', label: '全部' },
          { value: 'mine', label: `我的${me && mineCount > 0 ? ` ${mineCount}` : ''}` },
          { value: 'overdue', label: `逾期${overdueCount > 0 ? ` ${overdueCount}` : ''}` },
        ]}
        style={{ marginLeft: 12 }}
      />

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
      </Space>

      {me ? (
        <Dropdown menu={menu} trigger={['click']}>
          <Space style={{ cursor: 'pointer', padding: '2px 8px', borderRadius: 20 }}>
            <Avatar size={26} style={avatarStyle(me)}>
              {me.slice(0, 1).toUpperCase()}
            </Avatar>
            <Typography.Text strong style={{ maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {me}
            </Typography.Text>
          </Space>
        </Dropdown>
      ) : (
        <Space.Compact>
          <Input
            placeholder="输入你的名字，开始认领任务"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onPressEnter={commitName}
            prefix={<UserOutlined style={{ color: 'rgba(31,36,48,0.4)' }} />}
            style={{ width: 190 }}
            allowClear
          />
          <Button type="primary" onClick={commitName} disabled={!nameInput.trim()}>
            确定
          </Button>
        </Space.Compact>
      )}

      <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewTaskOpen(true)}>
        新建任务
      </Button>
    </Header>
  )
}
