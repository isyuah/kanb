import { useCallback, useMemo } from 'react'
import { Avatar, Empty, Progress, Tag, Typography } from 'antd'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react'
import dagre from 'dagre'
import '@xyflow/react/dist/style.css'
import { useKanban } from '../store'
import { useUI } from '../ui'
import type { Task } from '../types'
import { avatarStyle, taskPercent } from '../lib'

/** Extract the task payload from a React Flow node's data bag. */
function getNodeTask(n: Node): Task | undefined {
  const d = n.data
  if (d && typeof d === 'object' && 'task' in d) {
    const t = (d as { task: Task }).task
    return t && typeof t === 'object' && 'id' in t ? t : undefined
  }
  return undefined
}

const STATUS_COLOR: Record<Task['status'], string> = {
  todo: '#9aa0ad',
  in_progress: '#4f6ef7',
  done: '#2fbf71',
}

const STATUS_LABEL: Record<Task['status'], string> = {
  todo: '待认领',
  in_progress: '进行中',
  done: '已完成',
}

const NODE_W = 230
const NODE_H = 96

function GraphNode({ data }: { data: { task: Task } }) {
  const { task } = data
  const pct = taskPercent(task)
  const color = STATUS_COLOR[task.status]
  const overdue = !!task.dueDate && task.status !== 'done' && new Date(task.dueDate).getTime() < Date.now()
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        style={{
          width: NODE_W - 4,
          background: '#fff',
          border: `2px solid ${color}`,
          borderLeft: `5px solid ${color}`,
          borderRadius: 12,
          padding: '8px 12px 6px',
          boxShadow: '0 2px 8px rgba(31,36,48,0.08)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              background: color,
              flexShrink: 0,
            }}
          />
          <Typography.Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
            {task.title}
          </Typography.Text>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
          {task.claims.length > 0 ? (
            <Avatar.Group size={18} max={{ count: 3 }}>
              {task.claims.map((c) => (
                <Avatar key={c.id} size={18} style={avatarStyle(c.claimer)}>
                  {c.claimer.slice(0, 1).toUpperCase()}
                </Avatar>
              ))}
            </Avatar.Group>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              未认领
            </Typography.Text>
          )}
          <div style={{ flex: 1 }} />
          {overdue && (
            <Typography.Text type="danger" style={{ fontSize: 10 }}>
              已逾期
            </Typography.Text>
          )}
          {task.dueDate && !overdue && (
            <Typography.Text type="secondary" style={{ fontSize: 10 }}>
              {task.dueDate.slice(5)}
            </Typography.Text>
          )}
          {task.tags.slice(0, 2).map((t) => (
            <Tag key={t} style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px', padding: '0 6px' }}>
              {t}
            </Tag>
          ))}
        </div>

        {task.claims.length > 0 && (
          <Progress
            percent={pct}
            size="small"
            showInfo={false}
            strokeColor={pct >= 100 ? '#2fbf71' : '#4f6ef7'}
            style={{ margin: 0 }}
          />
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <Tag color={STATUS_COLOR[task.status]} style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px', border: 'none', color: '#fff' }}>
            {STATUS_LABEL[task.status]}
          </Tag>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  )
}

const nodeTypes = { task: GraphNode }

export default function DepGraph() {
  const tasks = useKanban((s) => s.tasks)
  const openTask = useUI((s) => s.openTask)
  const nonArchived = useMemo(() => tasks.filter((t) => !t.archived), [tasks])

  const { nodes, edges } = useMemo(() => {
    // dagre layered layout: edge task -> dep (前置在左，依赖者靠右)
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 })

    const ids = new Set(nonArchived.map((t) => t.id))
    const nodeMap = new Map(nonArchived.map((t) => [t.id, t]))
    for (const t of nonArchived) g.setNode(t.id, { width: NODE_W, height: NODE_H })
    for (const t of nonArchived) {
      for (const d of t.deps) {
        if (ids.has(d.depId)) g.setEdge(d.depId, t.id) // 前置(depId)在左，任务(t)在右
      }
    }

    dagre.layout(g)

    const n: Node[] = nonArchived.map((t) => {
      const pos = g.node(t.id)
      return {
        id: t.id,
        type: 'task',
        position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
        data: { task: t },
      }
    })

    const e: Edge[] = []
    for (const t of nonArchived) {
      for (const d of t.deps) {
        const dep = nodeMap.get(d.depId)
        if (!dep) continue
        e.push({
          id: `${t.id}->${d.depId}`,
          source: d.depId,
          target: t.id,
          animated: dep.status !== 'done',
          style: {
            stroke: dep.status === 'done' ? '#2fbf71' : dep.status === 'in_progress' ? '#4f6ef7' : '#b8bcc8',
            strokeWidth: 1.8,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: dep.status === 'done' ? '#2fbf71' : '#b8bcc8' },
        })
      }
    }
    return { nodes: n, edges: e }
  }, [nonArchived])

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => openTask(node.id),
    [openTask],
  )

  if (nonArchived.length === 0) {
    return <Empty description="还没有任务，先新建一个吧" style={{ marginTop: 80 }} />
  }

  return (
    <div style={{ height: '100%', background: '#f7f8fc', borderRadius: 16, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={1.6}
        nodesDraggable
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1} color="#e3e6f0" />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const t = getNodeTask(n)
            return t ? STATUS_COLOR[t.status] : '#c9cdd8'
          }}
        />
      </ReactFlow>
    </div>
  )
}
