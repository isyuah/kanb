import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Flex,
  Select,
  Spin,
  Table,
  Tag,
  Typography,
} from 'antd'
import { FileTextOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { DatePicker } from 'antd'

dayjs.extend(utc)
import { api } from '../api'
import { useKanban } from '../store'
import type { ReportEvent, ReportResult } from '../types'
import { statusLabelRaw } from '../status'

const { RangePicker } = DatePicker
const { Text, Paragraph } = Typography

const ACTION_LABELS: Record<string, string> = {
  created: '创建任务',
  updated: '更新任务',
  claimed: '认领',
  unclaimed: '取消认领',
  progress: '报进度',
  progress_updated: '改进度',
  progress_deleted: '删进度',
  dep_added: '加依赖',
  dep_removed: '移依赖',
  deleted: '删除任务',
  restored: '恢复任务',
  purged: '彻底删除',
}

const ACTION_COLORS: Record<string, string> = {
  created: 'blue',
  updated: 'geekblue',
  claimed: 'green',
  unclaimed: 'default',
  progress: 'cyan',
  progress_updated: 'cyan',
  progress_deleted: 'red',
  dep_added: 'purple',
  dep_removed: 'purple',
  deleted: 'red',
  restored: 'orange',
  purged: 'red',
}

/** 事件类型过滤组：UI 上按语义大类多选，空 = 全部 */
const KIND_GROUPS: { key: string; label: string; actions: string[] }[] = [
  { key: 'progress', label: '进度', actions: ['progress', 'progress_updated', 'progress_deleted'] },
  { key: 'claim', label: '认领', actions: ['claimed', 'unclaimed'] },
  { key: 'created', label: '创建任务', actions: ['created'] },
  { key: 'updated', label: '更新任务', actions: ['updated'] },
  { key: 'dep', label: '依赖', actions: ['dep_added', 'dep_removed'] },
  { key: 'trash', label: '删除/恢复', actions: ['deleted', 'restored', 'purged'] },
]
/** 选中组 → 放行的事件 action 集合（null = 放行全部） */
function kindFilter(kinds: string[]): Set<string> | null {
  if (kinds.length === 0) return null
  return new Set(KIND_GROUPS.filter((g) => kinds.includes(g.key)).flatMap((g) => g.actions))
}

interface Detail {
  p?: number
  text?: string
  f?: string
  t?: string
  title?: string
  old?: string
  new?: string
  tags?: string[]
  due?: string
  arc?: boolean
  who?: string
  dep?: string
  id?: string
}

function parseDetail(ev: ReportEvent): Detail | null {
  if (!ev.detail) return null
  try {
    return typeof ev.detail === 'string' ? (JSON.parse(ev.detail) as Detail) : (ev.detail as unknown as Detail)
  } catch {
    return null
  }
}

/** 事件 → 人类可读的说明（含 detail 快照） */
function describe(ev: ReportEvent): string {
  const d = parseDetail(ev)
  const base = ACTION_LABELS[ev.action] ?? ev.action
  if (!d) return base
  if (ev.action === 'updated') {
    if (d.f && d.t) return `状态 ${statusLabelRaw(String(d.f))} → ${statusLabelRaw(String(d.t))}`
    if (d.old !== undefined && d.new !== undefined) return `${d.old} → ${d.new}`
    if (d.arc !== undefined) return d.arc ? '归档' : '取消归档'
    if (d.due !== undefined) return `截止 ${d.due || '（清除）'}`
    if (d.tags) return `标签 ${d.tags.join('、') || '（清空）'}`
    return '更新任务'
  }
  if (ev.action === 'progress' || ev.action === 'progress_updated') {
    return `进度 ${d.p}%${d.text ? `：${d.text.slice(0, 60)}${d.text.length > 60 ? '…' : ''}` : ''}`
  }
  if (ev.action === 'progress_deleted') return `删除进度（原 ${d.p}%）`
  if (ev.action === 'dep_added') return '添加依赖'
  if (ev.action === 'dep_removed') return '移除依赖'
  if (ev.action === 'created') return '创建任务'
  if (d.title) return `${base}：${d.title}`
  return base
}

/** 报表页：半周报 —— 选时间窗口 + 成员，看这段时间每个人的可汇报动作 */
export default function ReportPage() {
  const user = useKanban((s) => s.user)
  const isAdminUser = user?.role === 'admin'
  const { message } = App.useApp()

  // 默认本周一 00:00（本地）～ 今天/上周五（结束取次日 00:00，含整天，后端 [from,to) 半开）
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(() => {
    const now = dayjs()
    const dow = (now.day() + 6) % 7 // 0=周一 … 6=周日
    const monday = now.startOf('day').subtract(dow, 'day')
    // 周一～周三 默认看到今天；周四～周日 看到周五（本周工作日完）
    const end = dow <= 2 ? now : monday.add(5, 'day')
    return [monday, end]
  })
  const [members, setMembers] = useState<string[]>([]) // 空 = 全部
  // 事件类型过滤（空 = 全部）
  const [kinds, setKinds] = useState<string[]>([])
  const [userOptions, setUserOptions] = useState<{ id: string; name: string }[]>([])
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 拉成员列表（admin 才可全量；member 只看自己）
  useEffect(() => {
    let alive = true
    if (isAdminUser) {
      api
        .listUsers()
        .then((us) => alive && setUserOptions(us.map((u) => ({ id: u.id, name: u.displayName || u.username }))))
        .catch(() => {})
    } else if (user) {
      setUserOptions([{ id: user.id, name: user.displayName || user.username }])
    }
    return () => {
      alive = false
    }
  }, [isAdminUser, user])

  const load = useCallback(
    async (r: [Dayjs, Dayjs] | null, m: string[]) => {
      if (!r || !r[0] || !r[1]) return
      // 非 admin 只能看自己（后端 member 过滤；admin 空=全部）
      const who = isAdminUser ? m : user ? [user.id] : []
      setLoading(true)
      setErr(null)
      try {
        const res = await api.semiweeklyReport(r[0].utc().format('YYYY-MM-DDTHH:mm:ss[Z]'), r[1].utc().format('YYYY-MM-DDTHH:mm:ss[Z]'), who)
        setResult(res)
      } catch (e) {
        setErr(e instanceof Error ? e.message : '加载失败')
        setResult(null)
      } finally {
        setLoading(false)
      }
    },
    [isAdminUser, user],
  )

  // 首次 + 依赖变化加载
  useEffect(() => {
    void load(range, members)
  }, [range, members, load])

  const grouped = useMemo(() => {
    if (!result) return []
    const allow = kindFilter(kinds)
    const map = new Map<string, ReportEvent[]>()
    for (const ev of result.events) {
      if (allow && !allow.has(ev.action)) continue
      const arr = map.get(ev.userName) ?? []
      arr.push(ev)
      map.set(ev.userName, arr)
    }
    return [...map.entries()].map(([name, evs]) => ({
      name,
      events: evs.sort((a, b) => a.at.localeCompare(b.at)),
      count: evs.length,
    }))
  }, [result, kinds])

  // 复制 Markdown
  const toMarkdown = () => {
    if (!result) return ''
    const lines: string[] = []
    lines.push(`# 半周报 ${dayjs(result.from).format('MM-DD')} ~ ${dayjs(result.to).format('MM-DD')}`)
    for (const g of grouped) {
      lines.push(`\n## ${g.name}`)
      for (const ev of g.events) {
        const t = dayjs(ev.at)
        lines.push(`- **${ev.taskTitle}** · ${describe(ev)}（${t.format('MM-DD HH:mm')}）`)
      }
    }
    return lines.join('\n')
  }

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown())
      message.success('已复制 Markdown')
    } catch {
      message.warning('复制失败，请手动选择')
    }
  }

  const total = grouped.reduce((n, g) => n + g.count, 0)

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <Card size="small">
        <Flex wrap gap={12} align="center">
          <RangePicker
            allowClear={false}
            showTime={{ format: 'HH:mm', minuteStep: 5 }}
            format="YYYY-MM-DD HH:mm"
            value={range}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            style={{ width: 340 }}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="全部事件类型"
            style={{ minWidth: 180, maxWidth: 300 }}
            value={kinds}
            onChange={(v: string[]) => setKinds(v)}
            options={KIND_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
          />
          {isAdminUser && (
            <Select
              mode="multiple"
              allowClear
              placeholder="全部成员"
              style={{ minWidth: 200, maxWidth: 320 }}
              value={members}
              onChange={(v: string[]) => setMembers(v)}
              options={userOptions.map((u) => ({ value: u.id, label: u.name }))}
            />
          )}
          <Button icon={<ReloadOutlined />} onClick={() => void load(range, members)}>
            刷新
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => void copyMd()}>
            复制 Markdown
          </Button>
          <Text type="secondary">
            {result ? `${total} 条事件 · ${grouped.length} 人` : ''}
          </Text>
        </Flex>
        <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>
          时区按本机（{dayjs().format('Z')}）解析：选中的起止时刻会换算成 UTC 查询；进度/状态/认领等操作
          落在窗口内即计入。
        </Paragraph>
      </Card>

      {err && (
        <Alert type="error" showIcon message={err} onClose={() => setErr(null)} closable />
      )}

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <Spin style={{ margin: '48px auto' }} />
        ) : total === 0 ? (
          <Empty description="该时间段内没有可汇报操作" style={{ marginTop: 48 }} />
        ) : (
          grouped.map((g) => (
            <Card key={g.name} size="small" title={<Text strong>{g.name}</Text>} extra={<Text type="secondary">{g.count} 条</Text>}>
              <Table<ReportEvent>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={g.events}
                columns={[
                  {
                    title: '时间',
                    dataIndex: 'at',
                    width: 130,
                    render: (v: string) => dayjs(v).format('MM-DD HH:mm'),
                  },
                  {
                    title: '任务',
                    dataIndex: 'taskTitle',
                    ellipsis: true,
                    render: (v: string) => <Text strong>{v}</Text>,
                  },
                  {
                    title: '动作',
                    dataIndex: 'action',
                    width: 110,
                    render: (_: string, ev: ReportEvent) => (
                      <Tag color={ACTION_COLORS[ev.action] ?? 'default'}>{ACTION_LABELS[ev.action] ?? ev.action}</Tag>
                    ),
                  },
                  {
                    title: '说明',
                    dataIndex: 'detail',
                    render: (_: string, ev: ReportEvent) => <Text style={{ whiteSpace: 'pre-wrap' }}>{describe(ev)}</Text>,
                  },
                ]}
              />
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
