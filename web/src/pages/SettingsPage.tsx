import { useEffect, useState } from 'react'
import { App, Button, Card, Radio, Space, Typography } from 'antd'
import { GlobalOutlined } from '@ant-design/icons'
import { api } from '../api'
import type { PublicMode } from '../types'
import { PUBLIC_MODE_DESC, PUBLIC_MODE_LABELS } from '../types'

const { Text, Title, Paragraph } = Typography

/** 系统设置：公开度控制（admin） */
export default function SettingsPage() {
  const { message } = App.useApp()
  const [mode, setMode] = useState<PublicMode>('private')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        setMode(s.publicMode)
        setLoaded(true)
      })
      .catch((e) => message.error((e as Error).message))
  }, [message])

  const save = async () => {
    setSaving(true)
    try {
      const s = await api.updateSettings({ publicMode: mode })
      setMode(s.publicMode)
      message.success('已保存：站点当前为' + PUBLIC_MODE_LABELS[s.publicMode])
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
      <Paragraph type="secondary">控制未登录访客的访问级别；已登录用户按角色权限操作，不受此限制。</Paragraph>

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

          <Button type="primary" onClick={() => void save()} loading={saving} disabled={!loaded}>
            保存设置
          </Button>
        </Space>
      </Card>
    </div>
  )
}
