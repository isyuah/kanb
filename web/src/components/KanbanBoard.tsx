import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Badge, Progress, Tag, Tooltip, Typography } from 'antd'
import { ClockCircleOutlined, FlagOutlined, LinkOutlined } from '@ant-design/icons'
import type { Task } from '../types'
import { STATUS_ORDER, type Status } from '../types'
import { useKanban } from '../store'
import { useUI } from '../ui'
import { avatarStyle, daysLeft, isOverdue, taskPercent } from '../lib'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const COLUMN_META: Record<Status, { title: string; accent: string; bg: string }> = {
  todo: { title: '待认领', accent: '#8c8c8c', bg: 'rgba(140,140,140,0.08)' },
  in_progress: { title: '进行中', accent: '#4f6ef7', bg: 'rgba(79,110,247,0.08)' },
  done: { title: '已完成', accent: '#2fbf71', bg: 'rgba(47,191,113,0.08)' },
}

const ALL_STATUS: Status[] = ['todo', 'in_progress', 'done']

export default function KanbanBoard() {
  const tasks = useKanban((s) => s.tasks)
  const me = useKanban((s) => s.me)
  const query = useUI((s) => s.query)
  const filter = useUI((s) => s.filter)
  const openTask = useUI((s) => s.openTask)
  const patchTask = useKanban((s) => s.patchTask)
  const reorderTasks = useKanban((s) => s.reorderTasks)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<Status | null>(null)
  // 乐观排序：拖拽期间各列的任务 id 序列（真实顺序以服务端为准）
  const [colItems, setColItems] = useState<Record<Status, string[]> | null>(null)
  const colItemsRef = useRef<Record<Status, string[]> | null>(null)
  colItemsRef.current = colItems
  const lastDragEndRef = useRef(0)
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null

  const filtered = useMemo(() => {
    let list = tasks
    if (filter === 'mine') {
      list = list.filter((t) => t.claims.some((c) => c.claimer === me))
    } else if (filter === 'overdue') {
      list = list.filter(
        (t) => t.dueDate && t.status !== 'done' && new Date(t.dueDate).getTime() < Date.now(),
      )
    }
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((t) => {
      const hay = [
        t.title,
        t.content,
        ...t.tags,
        ...t.claims.map((c) => c.claimer),
        ...t.progress.map((p) => p.text),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [tasks, query, filter, me])

  // 从服务端任务派生列序列（仅当无进行中拖拽时同步）
  const derived = useMemo(() => {
    const m: Record<Status, Task[]> = { todo: [], in_progress: [], done: [] }
    for (const t of filtered) m[t.status].push(t)
    return m
  }, [filtered])

  // 派生序跟随服务端；仅拖拽期间冻结本地乐观序
  useEffect(() => {
    if (activeId) return // 拖拽中不覆盖乐观移动
    const next: Record<Status, string[]> = { todo: [], in_progress: [], done: [] }
    for (const st of ALL_STATUS) next[st] = derived[st].map((t) => t.id)
    setColItems(next)
  }, [derived, activeId])

  const statusOf = (id: string): Status | null => {
    if (!colItems) return null
    for (const st of ALL_STATUS) if (colItems[st].includes(id)) return st
    return null
  }

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id))
  }

  /** 拖拽悬停：跨列实时移动（乐观），同列实时重排 —— 目标列即时出现插入让位 */
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !colItems) return
    const activeIdStr = String(active.id)
    const overId = String(over.id)
    const to = overId.startsWith('col-')
      ? (overId.slice(4) as Status)
      : overId.startsWith('tail-')
        ? (overId.slice(5) as Status)
        : statusOf(overId)
    const from = statusOf(activeIdStr)
    if (!from || !to) return
    setOverStatus(to)
    // 指针相对 over 卡的上下位置：上 → 插前，下 → 插后（直觉：放卡下半/空白 → 排到后面）
    const translated = active.rect.current.translated
    const pointerY = translated ? translated.top + translated.height / 2 : null

    if (from === to) {
      const idxA = colItems[from].indexOf(activeIdStr)
      if (idxA < 0) return
      if (overId.startsWith('tail-') || overId.startsWith('col-')) {
        // 列尾/列空白：移到列尾（active 保留，arrayMove 到底）
        const at = colItems[from].length - 1
        if (at === idxA) return
        setColItems((prev) => prev && { ...prev, [from]: arrayMove(prev[from], idxA, at) })
      } else {
        // over 为卡片：指针在卡上半插前，下半插后
        const overEl = document.querySelector(`[data-task-id="${overId}"]`)
        const overRect = overEl?.getBoundingClientRect()
        const insertAfter = pointerY !== null && overRect ? pointerY > overRect.top + overRect.height / 2 : false
        const idxB = colItems[from].indexOf(overId)
        if (idxB < 0) return
        const target = insertAfter ? (idxA < idxB ? idxB : idxB + 1) : (idxA > idxB ? idxB : idxB - 1)
        const clamped = Math.max(0, Math.min(colItems[from].length - 1, target))
        if (clamped === idxA) return
        setColItems((prev) => prev && { ...prev, [from]: arrayMove(prev[from], idxA, clamped) })
      }
    } else {
      // 跨列：源列移除，插入目标列
      const fromItems = colItems[from].filter((x) => x !== activeIdStr)
      let toItems = colItems[to].filter((x) => x !== activeIdStr)
      if (overId.startsWith('tail-') || overId.startsWith('col-')) {
        toItems.push(activeIdStr)
      } else {
        const overEl = document.querySelector(`[data-task-id="${overId}"]`)
        const overRect = overEl?.getBoundingClientRect()
        const insertAfter = pointerY !== null && overRect ? pointerY > overRect.top + overRect.height / 2 : false
        const idxB = toItems.indexOf(overId)
        if (idxB >= 0) {
          const at = insertAfter ? idxB + 1 : idxB
          toItems = [...toItems.slice(0, at), activeIdStr, ...toItems.slice(at)]
        } else {
          toItems.push(activeIdStr)
        }
      }
      setColItems((prev) => prev && { ...prev, [from]: fromItems, [to]: toItems })
    }
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const activeIdStr = String(active.id)
    const finalItems = colItemsRef.current
    setActiveId(null)
    setOverStatus(null)
    lastDragEndRef.current = Date.now()
    if (!over || !finalItems) {
      setColItems(null) // 未落位/无乐观态：还原为服务端序
      return
    }
    const task = tasks.find((t) => t.id === activeIdStr)
    if (!task) return
    const overStr = over.id.toString()
    const targetStatus = overStr.startsWith('col-')
      ? (overStr.slice(4) as Status)
      : overStr.startsWith('tail-')
        ? (overStr.slice(5) as Status)
        : statusOf(overStr)
    const movedTo = targetStatus ?? task.status
    // 跨列：PATCH 状态（position 服务端重排到目标列尾，随后 reorder 校正）
    if (movedTo !== task.status) {
      void patchTask(task.id, { status: movedTo }).catch(() => setColItems(null))
    }
    // 持久化涉及列的完整顺序（源列若被移除也更新）
    const involved = new Set<Status>([task.status, movedTo])
    for (const st of involved) {
      const ids = finalItems[st] ?? []
      if (ids.length > 0) {
        void reorderTasks(st, ids).catch(() => setColItems(null))
      }
    }
    // 释放乐观态；服务端返回后 derived 重建同序列表
    setColItems(null)
  }

  const onDragCancel = () => {
    setActiveId(null)
    setOverStatus(null)
    setColItems(null)
  }

  const handleOpen = (id: string) => {
    if (Date.now() - lastDragEndRef.current < 250) return // 拖拽结束后的点击忽略
    openTask(id)
  }

  // 稳定引用：仅当 colItems(拖拽乐观序) 或 derived(服务端序) 变化时重建，
  // 避免每次渲染新数组导致 SortableContext 内部死循环(React #185)
  const visibleIds = useMemo(() => {
    const m: Record<Status, string[]> = { todo: [], in_progress: [], done: [] }
    for (const st of ALL_STATUS) {
      m[st] = colItems?.[st] ?? derived[st].map((t) => t.id)
    }
    return m
  }, [colItems, derived])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', overflowX: 'auto' }}>
        {STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            taskIds={visibleIds[status]}
            taskById={(id) => tasks.find((t) => t.id === id)}
            onOpen={handleOpen}
            isOver={overStatus === status}
          />
        ))}
        <DragOverlay dropAnimation={null}>
          {activeTask ? <TaskCardInner task={activeTask} overlay /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  )
}

function BoardColumn({
  status,
  taskIds,
  taskById,
  onOpen,
  isOver,
}: {
  status: Status
  taskIds: string[]
  taskById: (id: string) => Task | undefined
  onOpen: (id: string) => void
  isOver: boolean
}) {
  const meta = COLUMN_META[status]
  const { setNodeRef, isOver: dropOver } = useDroppable({ id: `col-${status}` })
  const highlighted = isOver || dropOver
  const tasks = taskIds.map((id) => taskById(id)).filter((t): t is Task => !!t)
  return (
    <div
      ref={setNodeRef}
      style={{
        flex: '0 0 330px',
        display: 'flex',
        flexDirection: 'column',
        background: highlighted ? 'rgba(79,110,247,0.06)' : 'rgba(255,255,255,0.7)',
        borderRadius: 14,
        border: `1px solid ${highlighted ? 'rgba(79,110,247,0.45)' : 'rgba(31,36,48,0.06)'}`,
        maxHeight: '100%',
        transition: 'background .15s ease, border-color .15s ease',
      }}
    >
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: meta.accent,
            boxShadow: `0 0 0 3px ${meta.bg}`,
          }}
        />
        <Typography.Text strong>{meta.title}</Typography.Text>
        <Badge
          count={tasks.length}
          showZero
          style={{ backgroundColor: meta.bg, color: meta.accent, fontWeight: 700, boxShadow: 'none' }}
        />
      </div>
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          style={{
            padding: '0 10px 10px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} onOpen={onOpen} />
          ))}
          {/* 列尾放置区：拖到列表末尾空白 → 追加到列尾；空列时兼作空态提示 */}
          <ColumnTailDrop status={status} empty={tasks.length === 0} highlighted={highlighted} />
        </div>
      </SortableContext>
    </div>
  )
}

/** 列尾放置区：悬停此区 = 排到该列末尾 */
function ColumnTailDrop({
  status,
  empty,
  highlighted,
}: {
  status: Status
  empty: boolean
  highlighted: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `tail-${status}` })
  const active = isOver || (empty && highlighted)
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: active ? 64 : empty ? 64 : 18,
        borderRadius: 10,
        border: active ? '2px dashed rgba(79,110,247,0.55)' : empty ? '1.5px dashed rgba(31,36,48,0.15)' : '2px dashed transparent',
        background: active ? 'rgba(79,110,247,0.08)' : 'transparent',
        transition: 'border-color .15s ease, background .15s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? 'rgba(79,110,247,0.8)' : 'rgba(31,36,48,0.35)',
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      {active ? (empty ? '松开放入此处' : '松开放入列尾') : empty ? '暂无任务' : ''}
    </div>
  )
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })
  // dnd-kit: 非拖拽卡在排序变化时获得 transform 位移 + transition → 平滑让位
  // 被拖卡: visibility hidden 保留原占位(高度), 视觉由 DragOverlay 浮层负责
  const style: React.CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition,
    visibility: isDragging ? 'hidden' : 'visible',
  }
  return (
    <div style={style}>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={() => onOpen(task.id)}
        className="kanb-card"
        data-task-id={task.id}
        style={{
          background: '#fff',
          borderRadius: 12,
          border: '1px solid rgba(31,36,48,0.08)',
          padding: '10px 12px',
          cursor: 'grab',
          touchAction: 'none',
          boxShadow: '0 1px 2px rgba(31,36,48,0.04)',
          transition: 'box-shadow .15s ease, border-color .15s ease',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 18px rgba(31,36,48,0.1)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(79,110,247,0.4)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(31,36,48,0.04)'
          ;(e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(31,36,48,0.08)'
        }}
      >
        <TaskCardInner task={task} />
      </div>
    </div>
  )
}

/** 卡片内容（列表与拖拽预览共用）。overlay 为预览浮层态。 */
function TaskCardInner({ task, overlay }: { task: Task; overlay?: boolean }) {
  const pct = taskPercent(task)
  const overdue = isOverdue(task)
  const blocked = task.deps.some((d) => d.status !== 'done')
  const me = useKanban((s) => s.me)
  const claimedByMe = task.claims.some((c) => c.claimer === me)
  return (
    <div style={{ width: overlay ? 300 : undefined }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {task.tags.map((tag) => (
          <Tag key={tag} style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '18px' }}>
            {tag}
          </Tag>
        ))}
      </div>
      <Typography.Text strong style={{ fontSize: 13.5, lineHeight: 1.45, display: 'block' }}>
        {task.title}
      </Typography.Text>
      {task.content && (
        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: 3 }}
          style={{ fontSize: 12, margin: '4px 0 0', lineHeight: 1.55 }}
        >
          {task.content}
        </Typography.Paragraph>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        {task.claims.length > 0 ? (
          <Avatar.Group size={22} max={{ count: 4 }}>
            {task.claims.map((c) => (
              <Tooltip key={c.id} title={c.claimer}>
                <Avatar style={avatarStyle(c.claimer)}>{c.claimer.slice(0, 1).toUpperCase()}</Avatar>
              </Tooltip>
            ))}
          </Avatar.Group>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(31,36,48,0.3)' }}>待认领</span>
        )}
        <div style={{ flex: 1 }} />
        {claimedByMe && (
          <Tooltip title="我已认领">
            <FlagOutlined style={{ color: '#4f6ef7', fontSize: 12 }} />
          </Tooltip>
        )}
        {task.deps.length > 0 && (
          <Tooltip title={blocked ? '有未完成的依赖' : '依赖已全部完成'}>
            <LinkOutlined style={{ color: blocked ? '#ef4d5a' : '#2fbf71', fontSize: 12 }} />
          </Tooltip>
        )}
        {task.dueDate && (
          <Tooltip title={`截止 ${task.dueDate}${overdue ? '（已逾期）' : ''}`}>
            <span
              style={{
                fontSize: 12,
                color: overdue ? '#ef4d5a' : daysLeft(task) <= 2 ? '#f7a13b' : 'rgba(31,36,48,0.45)',
                fontWeight: overdue ? 700 : 400,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <ClockCircleOutlined style={{ fontSize: 11 }} />
              {task.dueDate.slice(5)}
            </span>
          </Tooltip>
        )}
      </div>

      {pct > 0 && (
        <Progress
          percent={pct}
          size="small"
          showInfo={false}
          strokeColor={pct >= 100 ? '#2fbf71' : '#4f6ef7'}
          style={{ marginTop: 8 }}
        />
      )}
    </div>
  )
}
