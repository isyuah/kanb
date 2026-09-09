import { useCallback, useEffect, useState } from 'react'
import { App, Card, Col, Empty, Progress, Row, Space, Typography } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
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
import { STATUS_META, statusLabel } from '../status'
import type { Stats } from '../types'

const { Text } = Typography

const PALETTE = [
  '#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96',
  '#13c2c2', '#2f54eb', '#a0d911', '#fa541c',
]

function pickColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

const chartTooltipStyle = {
  borderRadius: 10,
  border: '1px solid rgba(31,36,48,0.08)',
  boxShadow: '0 8px 24px rgba(31,36,48,0.1)',
  fontSize: 13,
}

const TICK_FILL = 'rgba(31,36,48,0.55)'
const GRID_STROKE = 'rgba(31,36,48,0.06)'

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
    name: statusLabel(s.status),
    value: s.count,
    color: STATUS_META[s.status].accent,
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflow: 'auto',
        minHeight: 0,
        overflowX: 'hidden', // antd Row gutter 负边距避免水平溢出
        padding: '2px 8px', // 抵消 Row 负边距，保持视觉贴齐
      }}
    >
      {/* 顶部概览：数字卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card variant="borderless" style={{ borderRadius: 16, background: '#fff' }} styles={{ body: { padding: '18px 20px' } }}>
            <Space direction="vertical" size={2}>
              <Text type="secondary" style={{ fontSize: 13 }}>进行中任务</Text>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Text strong style={{ fontSize: 30, lineHeight: 1.1 }}>{stats.inProgress}</Text>
                <Text type="secondary" style={{ fontSize: 14 }}>/ {stats.taskTotal} 总任务</Text>
              </div>
              <Text style={{ fontSize: 12, color: '#4f6ef7' }}>
                <PieChartOutlined /> 在看板推进中
              </Text>
            </Space>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card variant="borderless" style={{ borderRadius: 16, background: 'rgba(47,191,113,0.06)' }} styles={{ body: { padding: '18px 20px' } }}>
            <Space direction="vertical" size={2}>
              <Text type="secondary" style={{ fontSize: 13 }}>已完成</Text>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Text strong style={{ fontSize: 30, lineHeight: 1.1, color: '#2fbf71' }}>{stats.done}</Text>
                <Text type="secondary" style={{ fontSize: 14 }}>个任务</Text>
              </div>
              <Text style={{ fontSize: 12, color: '#2fbf71' }}>
                <CheckCircleOutlined /> {stats.taskTotal > 0 ? Math.round((stats.done / stats.taskTotal) * 100) : 0}% 完成率
              </Text>
            </Space>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card variant="borderless" style={{ borderRadius: 16, background: 'rgba(239,77,90,0.05)' }} styles={{ body: { padding: '18px 20px' } }}>
            <Space direction="vertical" size={2}>
              <Text type="secondary" style={{ fontSize: 13 }}>已逾期</Text>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <Text strong style={{ fontSize: 30, lineHeight: 1.1, color: stats.overdue > 0 ? '#ef4d5a' : 'rgba(31,36,48,0.88)' }}>{stats.overdue}</Text>
                <Text type="secondary" style={{ fontSize: 14 }}>个未完成</Text>
              </div>
              <Text style={{ fontSize: 12, color: stats.overdue > 0 ? '#ef4d5a' : 'rgba(31,36,48,0.45)' }}>
                <ClockCircleOutlined /> {stats.overdue > 0 ? '需尽快处理' : '无逾期任务'}
              </Text>
            </Space>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card variant="borderless" style={{ borderRadius: 16, background: 'rgba(140,140,140,0.07)' }} styles={{ body: { padding: '18px 20px' } }}>
            <Space direction="vertical" size={2}>
              <Text type="secondary" style={{ fontSize: 13 }}>整体进度</Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Progress
                  type="circle"
                  percent={completion}
                  size={44}
                  strokeWidth={9}
                  strokeColor={{ '0%': '#4f6ef7', '100%': '#2fbf71' }}
                />
                <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  按认领者进度平均
                  <br />
                  归档 {stats.archived} · 废弃 {stats.abandoned} 个任务
                </Text>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 图表区 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            variant="borderless"
            title={
              <Space size={8}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: '#4f6ef7', display: 'inline-block' }} />
                <Text strong style={{ fontSize: 15 }}>任务状态分布</Text>
              </Space>
            }
            style={{ borderRadius: 16 }}
            styles={{ body: { padding: '8px 12px 16px' } }}
          >
            {stats.taskTotal === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={statusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={3}
                    strokeWidth={0}
                    label={(e) => (e.value > 0 ? `${e.name} ${e.value}` : '')}
                    labelLine={{ stroke: 'rgba(31,36,48,0.25)' }}
                  >
                    {statusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            variant="borderless"
            title={
              <Space size={8}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: '#2fbf71', display: 'inline-block' }} />
                <Text strong style={{ fontSize: 15 }}>成员工作量</Text>
              </Space>
            }
            style={{ borderRadius: 16 }}
            styles={{ body: { padding: '8px 12px 16px' } }}
          >
            {memberData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无认领" style={{ padding: '30px 0' }} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={memberData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barGap={4}>
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="name" tick={{ fill: TICK_FILL, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: TICK_FILL, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: 'rgba(79,110,247,0.05)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                  <Bar dataKey="taskCount" name="任务数" fill="#4f6ef7" radius={[6, 6, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="avgPct" name="平均进度 %" fill="#2fbf71" radius={[6, 6, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            variant="borderless"
            title={
              <Space size={8}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: '#f7a13b', display: 'inline-block' }} />
                <Text strong style={{ fontSize: 15 }}>标签分布</Text>
              </Space>
            }
            style={{ borderRadius: 16 }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            {tagData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={10}>
                {tagData.map((t) => (
                  <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Text style={{ width: 56, fontSize: 13, textAlign: 'right', flexShrink: 0 }}>{t.name}</Text>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Progress
                        percent={(t.count / Math.max(1, tagData[0].count)) * 100}
                        showInfo={false}
                        strokeColor={pickColor(t.name)}
                        strokeWidth={10}
                        trailColor="rgba(31,36,48,0.05)"
                      />
                    </div>
                    <Text strong style={{ width: 24, fontSize: 13, textAlign: 'center', flexShrink: 0 }}>{t.count}</Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            variant="borderless"
            title={
              <Space size={8}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: '#722ed1', display: 'inline-block' }} />
                <Text strong style={{ fontSize: 15 }}>任务创建分布</Text>
              </Space>
            }
            style={{ borderRadius: 16 }}
            styles={{ body: { padding: '8px 12px 16px' } }}
          >
            {creatorData.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={creatorData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="name" tick={{ fill: TICK_FILL, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: TICK_FILL, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: 'rgba(79,110,247,0.05)' }} />
                  <Bar dataKey="count" name="创建任务数" radius={[6, 6, 0, 0]} maxBarSize={34}>
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

      <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', paddingBottom: 4 }}>
        统计范围：未归档、未删除且未废弃的任务 · 进入页面时实时拉取
      </Text>
    </div>
  )
}
