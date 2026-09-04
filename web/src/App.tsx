import { useEffect } from 'react'
import { App as AntApp, Button, Layout, Result, Spin, Typography } from 'antd'
import { InboxOutlined, PlusOutlined } from '@ant-design/icons'
import { useKanban } from './store'
import { useUI } from './ui'
import TopBar from './components/TopBar'
import KanbanBoard from './components/KanbanBoard'
import DepGraph from './components/DepGraph'
import TaskDrawer from './components/TaskDrawer'
import NewTaskModal from './components/NewTaskModal'
import ArchiveModal from './components/ArchiveModal'
import FeedDrawer from './components/FeedDrawer'

const { Content } = Layout

export default function App() {
  const loaded = useKanban((s) => s.loaded)
  const tasks = useKanban((s) => s.tasks)
  const error = useKanban((s) => s.error)
  const refresh = useKanban((s) => s.refresh)
  const view = useUI((s) => s.view)
  const setNewTaskOpen = useUI((s) => s.setNewTaskOpen)

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <AntApp>
      <Layout style={{ minHeight: '100vh' }}>
        <TopBar />
        <Content
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: 'calc(100vh - 60px)',
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
          ) : view === 'board' ? (
            tasks.length === 0 ? (
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
          ) : (
            <DepGraph />
          )}
        </Content>
      </Layout>

      <TaskDrawer />
      <NewTaskModal />
      <ArchiveModal />
      <FeedDrawer />
    </AntApp>
  )
}
