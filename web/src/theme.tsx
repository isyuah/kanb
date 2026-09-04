import { ConfigProvider, theme as antTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import type { ReactNode } from 'react'

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: antTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f6ef7',
          colorInfo: '#4f6ef7',
          colorSuccess: '#2fbf71',
          colorWarning: '#f7a13b',
          colorError: '#ef4d5a',
          colorBgLayout: '#f5f6fb',
          borderRadius: 10,
          fontFamily:
            "-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
          colorTextBase: '#1f2430',
        },
        components: {
          Layout: {
            headerBg: '#ffffff',
            headerHeight: 60,
            headerPadding: '0 24px',
            siderBg: '#ffffff',
          },
          Card: {
            borderRadiusLG: 14,
          },
        },
      }}
      tooltip={{ unique: true }}
      drawer={{ mask: { blur: true } }}
      modal={{ mask: { blur: true } }}
    >
      {children}
    </ConfigProvider>
  )
}
