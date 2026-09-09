import { useEffect, useState } from 'react'
import { App, Button, Card, Divider, Radio, Space, Switch, Typography } from 'antd'
import { GlobalOutlined, UserAddOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { PublicMode } from '../types'
import { PUBLIC_MODE_DESC, PUBLIC_MODE_LABELS } from '../types'

const { Text, Title, Paragraph } = Typography

/** 系统设置：公开度 + 开放注册（admin） */
export default function SettingsPage() {
  const { message } = App.useApp()
  const [mode, setMode] = useState<PublicMode>('private')
  const [registration, setRegistration] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setMode(s.publicMode)
        setRegistration(s.registration)
        setLoaded(true)
      })
      .catch((e) => message.error((e as Error).message))
  }, [message])

  const save = async () => {
    setSaving(true)
    try {
      const s = await api.updateSettings({ publicMode: mode })
      setMode(s.publicMode)
      await api.updateRegistration(registration)
      message.success(
        `已保存：站点为「${PUBLIC_MODE_LABELS[mode]}」，${registration ? '开放自助注册' : '已关闭自助注册'}`,
      )
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <Title level={4} style={{ marginTop: 0 }}>
        系统设置
      </Title>
      <Paragraph type="secondary">
        公开度控制未登录访客的访问级别，已登录用户按角色权限操作、不受此限制；
        开放注册控制是否允许任何人在登录页自助注册账号。
      </Paragraph>

      <Card loading={!loaded} style={{ marginTop: 12 }}>
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Space size={12}>
            <GlobalOutlined style={{ fontSize: 20, color: '#4f6ef7' }} />
            <Text strong style={{ fontSize: 15 }}>
              公开度
            </Text>
          </Space>

          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as PublicMode)}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {(Object.keys(PUBLIC_MODE_DESC) as PublicMode[]).map((m) => (
              <div
                key={m}
                role="radio"
                aria-checked={mode === m}
                tabIndex={0}
                onClick={() => setMode(m)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setMode(m)
                  }
                }}
                style={{
                  border: '1px solid rgba(31,36,48,0.1)',
                  borderRadius: 12,
                  padding: '12px 16px',
                  cursor: 'pointer',
                  background: mode === m ? 'rgba(79,110,247,0.05)' : '#fff',
                  transition: 'border-color 0.2s, background 0.2s',
                }}
              >
                <Radio value={m} style={{ fontWeight: 600 }}>
                  {PUBLIC_MODE_LABELS[m]}
                </Radio>
                <Text type="secondary" style={{ fontSize: 13, display: 'block', marginLeft: 24, marginTop: 2 }}>
                  {PUBLIC_MODE_DESC[m]}
                </Text>
              </div>
            ))}
          </Radio.Group>

          <Divider style={{ margin: '4px 0' }} />

          <Space size={12} style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space direction="vertical" size={2}>
              <Space size={12}>
                <UserAddOutlined style={{ fontSize: 20, color: '#4f6ef7' }} />
                <Text strong style={{ fontSize: 15 }}>
                  开放自助注册
                </Text>
              </Space>
              <Text type="secondary" style={{ fontSize: 13, display: 'block', marginLeft: 32 }}>
                关闭后登录页不提供注册入口，新成员由管理员在「用户管理」中创建账号
              </Text>
            </Space>
            <Switch
              checked={registration}
              onChange={setRegistration}
              checkedChildren="开放"
              unCheckedChildren="关闭"
            />
          </Space>

          <Button type="primary" onClick={() => void save()} loading={saving} disabled={!loaded}>
            保存设置
          </Button>
        </Space>
      </Card>
    </div>
  )
}
