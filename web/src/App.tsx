import { useEffect } from 'react'
import { App as AntApp, Button, Layout, Result, Spin, Typography } from 'antd'
import { InboxOutlined, PlusOutlined } from '@ant-design/icons'
import { isAdmin, useKanban } from './store'
import { useUI } from './ui'
import type { View } from './ui'
import TopBar from './components/TopBar'
import KanbanBoard from './components/KanbanBoard'
import DepGraph from './components/DepGraph'
import TaskModal from './components/task/TaskModal'
import NewTaskModal from './components/NewTaskModal'
import ArchiveModal from './components/ArchiveModal'
import FeedDrawer from './components/FeedDrawer'
import ProfileModal from './components/ProfileModal'
import LoginModal from './components/LoginModal'
import { LoginGate } from './pages/LoginPage'
import CalendarPage from './pages/CalendarPage'
import TrashPage from './pages/TrashPage'
import UsersPage from './pages/UsersPage'
import SettingsPage from './pages/SettingsPage'
import StatsPage from './pages/StatsPage'
import ReportPage from './pages/ReportPage'

const { Content } = Layout

export default function App() {
  const loaded = useKanban((s) => s.loaded)
  const tasks = useKanban((s) => s.tasks)
  const error = useKanban((s) => s.error)
  const refresh = useKanban((s) => s.refresh)
  const refreshActivities = useKanban((s) => s.refreshActivities)
  const user = useKanban((s) => s.user)
  const publicMode = useKanban((s) => s.publicMode)
  const view = useUI((s) => s.view)
  const setNewTaskOpen = useUI((s) => s.setNewTaskOpen)

  // 登录门：私密模式 + 未登录 → 只渲染登录页
  const locked = !user && publicMode === 'private'

  useEffect(() => {
    if (!locked) {
      void refresh()
      void refreshActivities()
    }
  }, [refresh, refreshActivities, locked])

  const viewContent = (v: View) => {
    switch (v) {
      case 'graph':
        return <DepGraph />
      case 'calendar':
        return <CalendarPage />
      case 'stats':
        return <StatsPage />
      case 'report':
        return user ? (
          <ReportPage />
        ) : (
          <Result status="403" title="无权访问" subTitle="报表需登录后使用" />
        )
      case 'trash':
        return isAdmin(user) || (user && user.role === 'member') ? (
          <TrashPage />
        ) : (
          <Result status="403" title="无权访问" subTitle="回收站仅对成员开放" />
        )
      case 'users':
        return isAdmin(user) ? (
          <UsersPage />
        ) : (
          <Result status="403" title="无权访问" subTitle="用户管理仅对管理员开放" />
        )
      case 'settings':
        return isAdmin(user) ? (
          <SettingsPage />
        ) : (
          <Result status="403" title="无权访问" subTitle="系统设置仅对管理员开放" />
        )
      default:
        return tasks.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <InboxOutlined style={{ fontSize: 48, color: 'rgba(31,36,48,0.2)' }} />
              <Typography.Title level={4} style={{ marginTop: 16 }}>
                还没有任务
              </Typography.Title>
              <Typography.Paragraph type="secondary">
                创建第一个任务，开始团队协作
              </Typography.Paragraph>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewTaskOpen(true)}>
                新建任务
              </Button>
            </div>
          </div>
        ) : (
          <KanbanBoard />
        )
    }
  }

  return (
    <AntApp>
      {locked ? (
        <LoginGate />
      ) : (
        <Layout style={{ height: '100vh' }}>
          <TopBar />
          <Content
            style={{
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              flex: 1,
              overflow: 'auto',
            }}
          >
            {error && !loaded ? (
              <Result
                status="error"
                title="无法连接服务器"
                subTitle={error}
                extra={
                  <Button type="primary" onClick={() => void refresh()}>
                    重试
                  </Button>
                }
              />
            ) : !loaded ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spin size="large" description="加载中...">
                  <div style={{ width: 240, height: 120 }} />
                </Spin>
              </div>
            ) : (
              viewContent(view)
            )}
          </Content>
        </Layout>
      )}

      <TaskModal />
      <NewTaskModal />
      <ArchiveModal />
      <FeedDrawer />
      <ProfileModal />
      <LoginModal />
    </AntApp>
  )
}
