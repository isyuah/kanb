// 生成演示数据：三角色用户 + 一套"产品 2.3 迭代"任务看板数据
// 用法：先启动后端（go run . -addr :8400 -db demo.db），再 node scripts/seed-demo.mjs
const BASE = 'http://localhost:8420/api'
let ok = 0, fail = 0
const log = (n, c) => { if (c) { ok++; console.log('OK   ' + n) } else { fail++; console.log('FAIL ' + n) } }

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
  // ===== 1. 用户：管理员（运维组长）+ 三名成员（前端/后端/产品）+ 只读访客 =====
  let r = await req('POST', '/auth/register', { body: { username: 'ops', password: 'ops12345', displayName: '周健' } })
  log('注册 admin（首用户）', r.status === 201 && r.data?.user?.role === 'admin')
  const adminT = r.data?.token

  const members = [
    ['fe', '陈晓', '前端工程师'],
    ['be', '李华', '后端工程师'],
    ['pm', '王芳', '产品经理'],
  ]
  const userTokens = {}
  for (const [u, dn] of members) {
    r = await req('POST', '/auth/register', { body: { username: u, password: 'pass1234', displayName: dn } })
    log(`注册 ${dn}`, r.status === 201)
    userTokens[u] = r.data?.token
  }
  r = await req('POST', '/auth/register', { body: { username: 'guest', password: 'guest123', displayName: '赵观察' } })
  log('注册 guest（访客）', r.status === 201)
  const guestId = r.data?.user?.id
  r = await req('PUT', `/users/${guestId}/role`, { token: adminT, body: { role: 'viewer' } })
  log('guest 设为 viewer', r.status === 204)

  // ===== 2. 任务：一套 2.3 迭代的开发看板 =====
  const mk = async (u, title, extra = {}) => {
    r = await req('POST', '/tasks', { token: userTokens[u], body: { title, tags: extra.tags || [], dueDate: extra.dueDate || null, content: extra.content || '', ...(extra.status ? { status: extra.status } : {}) } })
    log(`创建 ${title}`, r.status === 201)
    return r.data?.id
  }
  const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

  // 待认领（todo）
  const t1 = await mk('pm', '用户反馈：移动端适配问卷调研', { tags: ['产品', '调研'], dueDate: daysFromNow(5), content: '收集 30 份使用反馈，输出适配优先级' })
  const t2 = await mk('fe', '修复看板拖拽在 Safari 的兼容问题', { tags: ['前端', 'bug'], dueDate: daysFromNow(2), content: 'Safari 下拖拽手柄无响应，复现路径见工单 #217' })
  // 进行中（in_progress）
  const t3 = await mk('be', '依赖环校验接口压测与优化', { tags: ['后端', '性能'], dueDate: daysFromNow(1), status: 'in_progress', content: '千级任务规模下 BFS 防环耗时优化' })
  const t4 = await mk('be', '开放 API 限流与鉴权改造', { tags: ['后端', '安全'], dueDate: daysFromNow(3), status: 'in_progress' })
  const t5 = await mk('fe', '看板筛选器体验打磨', { tags: ['前端', 'UX'], dueDate: daysFromNow(4), status: 'in_progress' })
  // 已完成（done）
  const t6 = await mk('pm', '2.3 迭代需求评审', { tags: ['产品', '需求'], status: 'done' })
  const t7 = await mk('be', '数据库索引优化（查询提速）', { tags: ['后端', '性能'], status: 'done' })
  const t8 = await mk('fe', '任务卡片逾期高亮', { tags: ['前端', 'UX'], status: 'done' })

  // ===== 3. 认领（多对多） =====
  await req('POST', `/tasks/${t3}/claim`, { token: userTokens['be'] })
  await req('POST', `/tasks/${t3}/claim`, { token: userTokens['fe'] })   // 前后端共同推进压测
  await req('POST', `/tasks/${t4}/claim`, { token: userTokens['be'] })
  await req('POST', `/tasks/${t5}/claim`, { token: userTokens['fe'] })
  await req('POST', `/tasks/${t1}/claim`, { token: userTokens['pm'] })
  log('设置认领', true)

  // ===== 4. 进度记录 =====
  await req('POST', `/tasks/${t3}/progress`, { token: userTokens['be'], body: { percent: 60, text: '千级任务防环压测通过，最坏 12ms' } })
  await req('POST', `/tasks/${t3}/progress`, { token: userTokens['fe'], body: { percent: 40, text: '补充了拖拽场景下的环提示用例' } })
  await req('POST', `/tasks/${t4}/progress`, { token: userTokens['be'], body: { percent: 80, text: '限流中间件完成，剩鉴权接入' } })
  await req('POST', `/tasks/${t5}/progress`, { token: userTokens['fe'], body: { percent: 45, text: '组合筛选交互原型完成' } })
  log('添加进度记录', true)

  // ===== 5. 依赖链：t7(索引) -> t3(压测) -> t4(限流)；t6(评审) -> t1(调研) =====
  await req('POST', `/tasks/${t3}/deps`, { token: userTokens['be'], body: { depId: t7 } })
  await req('POST', `/tasks/${t4}/deps`, { token: userTokens['be'], body: { depId: t3 } })
  await req('POST', `/tasks/${t1}/deps`, { token: userTokens['pm'], body: { depId: t6 } })
  await req('POST', `/tasks/${t5}/deps`, { token: userTokens['fe'], body: { depId: t3 } })
  log('设置依赖链', true)

  // ===== 6. 一条逾期未完成（供逾期高亮/统计演示） =====
  await mk('fe', 'Chrome 旧版本兼容回归', { tags: ['前端', 'bug'], dueDate: daysFromNow(-2), status: 'in_progress' })

  // ===== 7. 一条归档任务（供归档演示） =====
  const ta = await mk('pm', '历史需求清理：2.1 遗留项归档', { tags: ['产品'], status: 'done' })
  r = await req('PATCH', `/tasks/${ta}`, { token: userTokens['pm'], body: { archived: true } })
  log('归档一条历史任务', r.status === 200)

  // ===== 8. 公开度设为 readonly（演示访客浏览） =====
  r = await req('PUT', '/settings/public-mode', { token: adminT, body: { publicMode: 'readonly' } })
  log('公开度 -> readonly', r.status === 200)
  r = await req('GET', '/tasks')
  log('匿名可读（游客浏览）', r.status === 200 && r.data?.length >= 8)

  console.log(`\n==== 演示数据生成: ${ok} ok, ${fail} fail ====`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('ERR', e); process.exit(2) })
