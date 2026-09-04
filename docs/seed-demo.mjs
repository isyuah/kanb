// 生成课设演示数据：三角色用户 + 一套像样的任务看板数据
const BASE = 'http://localhost:8410/api'
let ok = 0, fail = 0
const log = (n, c) => { if (c) { ok++; console.log('OK ' + n) } else { fail++; console.log('FAIL ' + n) } }

async function req(method, path, { token, body } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(BASE + path, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status: res.status, data }
  } finally { clearTimeout(timer) }
}

const main = async () => {
  // ===== 1. 用户：首管理员 + 成员 + 访客 =====
  let r = await req('POST', '/auth/register', { body: { username: 'admin', password: 'admin123', displayName: '张老师' } })
  log('注册 admin(首用户)', r.status === 201 && r.data?.user?.role === 'admin')
  const adminT = r.data?.token
  const adminId = r.data?.user?.id

  const members = [
    ['chen', '陈晓', '前端开发'],
    ['li', '李华', '后端开发'],
    ['wang', '王芳', '产品经理'],
  ]
  const userTokens = {}
  for (const [u, dn] of members) {
    r = await req('POST', '/auth/register', { body: { username: u, password: 'pass1234', displayName: dn } })
    log(`注册 ${dn}`, r.status === 201)
    userTokens[u] = r.data?.token
  }
  // 一个 viewer（只读访客）
  r = await req('POST', '/auth/register', { body: { username: 'guest1', password: 'guest123', displayName: '赵观察' } })
  log('注册 guest', r.status === 201)
  const guestId = r.data?.user?.id
  r = await req('PUT', `/users/${guestId}/role`, { token: adminT, body: { role: 'viewer' } })
  log('guest 设为 viewer', r.status === 204)

  // ===== 2. 任务（跨三列，带标签/截止/依赖） =====
  const mk = async (u, title, extra = {}) => {
    r = await req('POST', '/tasks', { token: userTokens[u], body: { title, tags: extra.tags || [], dueDate: extra.dueDate || null, content: extra.content || '', ...(extra.status ? { status: extra.status } : {}) } })
    log(`创建任务 ${title}`, r.status === 201)
    return r.data?.id
  }
  const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

  // 待认领
  const t1 = await mk('wang', '设计课设汇报 PPT 模板', { tags: ['设计', '汇报'], dueDate: daysFromNow(5), content: '确定整体视觉风格与结构' })
  const t2 = await mk('chen', '修复看板拖拽在 Safari 的兼容问题', { tags: ['前端', 'bug'], dueDate: daysFromNow(2) })
  // 进行中
  const t3 = await mk('li', '数据库 3NF 论证文档', { tags: ['数据库', '课设'], dueDate: daysFromNow(1), status: 'in_progress', content: '逐表分析范式，含 ER 图' })
  const t4 = await mk('li', '用户认证模块联调', { tags: ['后端', '认证'], dueDate: daysFromNow(3), status: 'in_progress' })
  const t5 = await mk('chen', '日历视图样式打磨', { tags: ['前端', 'UI'], dueDate: daysFromNow(4), status: 'in_progress' })
  // 已完成
  const t6 = await mk('wang', '项目需求分析', { tags: ['文档', '课设'], status: 'done' })
  const t7 = await mk('li', '数据库表结构设计（12 表）', { tags: ['数据库', '设计'], status: 'done' })

  // ===== 3. 认领（多对多） =====
  await req('POST', `/tasks/${t3}/claim`, { token: userTokens['li'] })
  await req('POST', `/tasks/${t3}/claim`, { token: userTokens['chen'] })
  await req('POST', `/tasks/${t4}/claim`, { token: userTokens['li'] })
  await req('POST', `/tasks/${t5}/claim`, { token: userTokens['chen'] })
  await req('POST', `/tasks/${t1}/claim`, { token: userTokens['wang'] })
  log('认领设置', true)

  // ===== 4. 进度记录 =====
  await req('POST', `/tasks/${t3}/progress`, { token: userTokens['li'], body: { percent: 60, text: '已完成 tasks 与 claims 的论证，开始写 deps' } })
  await req('POST', `/tasks/${t3}/progress`, { token: userTokens['chen'], body: { percent: 30, text: '补充了 ER 图的关联标注' } })
  await req('POST', `/tasks/${t4}/progress`, { token: userTokens['li'], body: { percent: 80, text: '登录/注册已通，剩权限矩阵测试' } })
  await req('POST', `/tasks/${t5}/progress`, { token: userTokens['chen'], body: { percent: 45, text: '月度视图完成，周视图进行中' } })
  log('进度记录', true)

  // ===== 5. 依赖（防成环演示链） =====
  // t7(表设计) -> t3(3NF 文档) -> t4(联调) 演示依赖链
  await req('POST', `/tasks/${t3}/deps`, { token: userTokens['li'], body: { depId: t7 } })
  await req('POST', `/tasks/${t4}/deps`, { token: userTokens['li'], body: { depId: t3 } })
  await req('POST', `/tasks/${t5}/deps`, { token: userTokens['chen'], body: { depId: t3 } })
  log('依赖设置', true)

  // ===== 6. 公开度设为 readonly（演示访客可浏览） =====
  r = await req('PUT', '/settings/public-mode', { token: adminT, body: { publicMode: 'readonly' } })
  log('公开度 -> readonly', r.status === 200)
  r = await req('GET', '/tasks')
  log('匿名可读(演示访客浏览)', r.status === 200 && r.data?.length >= 6)

  console.log(`\n==== 演示数据: ${ok} ok, ${fail} fail ====`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('ERR', e); process.exit(2) })
