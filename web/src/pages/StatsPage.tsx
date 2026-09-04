import { useCallback, useEffect, useState } from 'react'
import {
  App,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Space,
  Statistic,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PieChartOutlined,
} from '@ant-design/icons'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../api'
import { statusMeta } from '../lib'
import type { Stats, Status } from '../types'

const { Text } = Typography

const STATUS_COLORS: Record<Status, string> = {
  todo: '#8c8c8c',
  in_progress: '#4f6ef7',
  done: '#2fbf71',
}

const PALETTE = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96',
  '#13c2c2', '#2f54eb', '#a0d911', '#fa541c',
]

function pickColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** 统计页：看板数据总览（状态/标签分布、成员工作量、逾期等） */
export default function StatsPage() {
  const { message } = App.useApp()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStats(await api.stats())
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void load()
  }, [load])

  if (!stats) {
    return (
      <Card loading={loading} style={{ flex: 1 }}>
        <Empty description="暂无统计" style={{ marginTop: 80 }} />
      </Card>
    )
  }

  const statusData = stats.byStatus.map((s) => ({
    name: statusMeta[s.status as Status].label,
    value: s.count,
    color: STATUS_COLORS[s.status as Status],
  }))
  const tagData = stats.byTag.map((t) => ({ name: t.tag, count: t.count }))
  const memberData = stats.byMember.map((m) => ({
    name: m.userName,
    taskCount: m.taskCount,
    avgPct: Math.round(m.avgPct),
  }))
  const creatorData = stats.byCreator.map((c) => ({
    name: c.userName || '匿名',
    count: c.count,
  }))

  const completion = Math.round(stats.avgTaskPct)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', minHeight: 0 }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="进行中任务" value={stats.inProgress} prefix={<PieChartOutlined />} suffix={`/ ${stats.taskTotal}`} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="已完成" value={stats.done} prefix={<CheckCircleOutlined style={{ color: '#2fbf71' }} />} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="已逾期"
              value={stats.overdue}
              prefix={<ClockCircleOutlined style={{ color: '#ef4d5a' }} />}
              valueStyle={stats.overdue > 0 ? { color: '#ef4d5a' } : undefined}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic title="已归档" value={stats.archived} prefix={<InboxOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="任务状态分布" size="small">
            {stats.taskTotal === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="成员工作量（认领任务数 & 平均进度）" size="small">
            {memberData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无认领" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={memberData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="taskCount" name="任务数" fill="#4f6ef7" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="avgPct" name="平均进度" fill="#2fbf71" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="标签分布" size="small">
            {tagData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {tagData.map((t) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text style={{ width: 90, textAlign: 'right' }}>{t.name}</Text>
                    <div style={{ flex: 1 }}>
                      <Progress percent={(t.count / Math.max(1, tagData[0].count)) * 100} showInfo={false} strokeColor={pickColor(t.name)} />
                    </div>
                    <Text type="secondary" style={{ width: 32 }}>{t.count}</Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="任务创建分布" size="small">
            {creatorData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={creatorData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="创建任务数" radius={[4, 4, 0, 0]}>
                    {creatorData.map((entry) => (
                      <Cell key={entry.name} fill={pickColor(entry.name)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ marginTop: 8 }}>
        <Space size={16} wrap>
          <Text strong>
            <FolderOpenOutlined /> 整体完成度
          </Text>
          <Progress type="circle" percent={completion} size={44} />
          <Text type="secondary">按所有认领者的进度记录平均计算；无认领任务计 0</Text>
        </Space>
      </Card>

      <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', paddingBottom: 8 }}>
        统计仅覆盖未归档且未删除的任务；数据在每次进入页面时实时拉取
      </Text>
    </div>
  )
}
