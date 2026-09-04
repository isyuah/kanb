import { useState } from 'react'
import { App, Button, Form, Input, Segmented, Typography } from 'antd'
import { LockOutlined, SafetyOutlined, UserOutlined } from '@ant-design/icons'
import { api } from '../api'
import { useKanban } from '../store'
import { useUI } from '../ui'

const { Title, Text } = Typography

/**
 * 登录/注册表单内容（不含外框）。
 * 由 LoginGate（整页场景）与 LoginModal（弹窗场景）各自套上合适的容器：
 * 避免「panel 内嵌 panel」导致的双层阴影与关闭按钮错位。
 */
export default function LoginForm() {
  const { message } = App.useApp()
  const applyAuth = useKanban((s) => s.applyAuth)
  const setView = useUI((s) => s.setView)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)

  const submit = async (v: { username: string; password: string; displayName?: string }) => {
    setLoading(true)
    try {
      const r =
        mode === 'login'
          ? await api.login(v.username, v.password)
          : await api.register(v.username, v.password, v.displayName)
      applyAuth(r)
      setView('board')
      message.success(mode === 'login' ? '登录成功' : '注册成功')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <Title level={3} style={{ marginBottom: 2, fontWeight: 800 }}>
          Kanb
        </Title>
        <Text type="secondary">团队任务看板</Text>
      </div>
      <Segmented
        block
        value={mode}
        onChange={(v) => setMode(v as 'login' | 'register')}
        options={[
          { value: 'login', label: '登录' },
          { value: 'register', label: '注册' },
        ]}
        style={{ margin: '12px 0 16px' }}
      />
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item
          name="username"
          rules={[{ required: true, message: '请输入用户名' }]}
          style={{ marginBottom: 12 }}
        >
          <Input
            prefix={<UserOutlined style={{ color: 'rgba(31,36,48,0.35)' }} />}
            placeholder="用户名"
            autoFocus
            autoComplete="username"
          />
        </Form.Item>
        {mode === 'register' && (
          <Form.Item name="displayName" style={{ marginBottom: 12 }}>
            <Input
              prefix={<SafetyOutlined style={{ color: 'rgba(31,36,48,0.35)' }} />}
              placeholder="展示名（可选，默认同用户名）"
              autoComplete="nickname"
            />
          </Form.Item>
        )}
        <Form.Item
          name="password"
          rules={[{ required: true, message: '请输入密码' }]}
          style={{ marginBottom: 8 }}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'rgba(31,36,48,0.35)' }} />}
            placeholder="密码（至少 6 位）"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </Form.Item>
        {mode === 'register' && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            第一个注册的用户将自动成为管理员。
          </Text>
        )}
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" block loading={loading} style={{ marginTop: 4 }}>
            {mode === 'login' ? '登 录' : '注 册'}
          </Button>
        </Form.Item>
      </Form>
    </div>
  )
}

/** 整页登录门：private 且未登录时，站点唯一可见内容 */
export function LoginGate() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background:
          'radial-gradient(1200px 600px at 20% -10%, rgba(79,110,247,0.14), transparent 60%), radial-gradient(900px 500px at 90% 110%, rgba(47,191,113,0.12), transparent 60%), #f5f6fb',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 380,
          maxWidth: '100%',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(12px)',
          borderRadius: 18,
          padding: '28px 30px 24px',
          boxShadow: '0 20px 60px rgba(31,36,48,0.16), 0 2px 8px rgba(31,36,48,0.05)',
          border: '1px solid rgba(255,255,255,0.7)',
        }}
      >
        <LoginForm />
      </div>
    </div>
  )
}
