import { useEffect } from 'react'
import { Modal } from 'antd'
import { useKanban } from '../store'
import LoginCard from '../pages/LoginPage'
import { useUI } from '../ui'

/** readonly/open 模式未登录用户点击「登录/注册」时的弹窗 */
export default function LoginModal() {
  const open = useUI((s) => s.loginOpen)
  const setOpen = useUI((s) => s.setLoginOpen)
  const user = useKanban((s) => s.user)

  // 登录/注册成功后自动关闭
  useEffect(() => {
    if (user) setOpen(false)
  }, [user, setOpen])

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      width={420}
      destroyOnHidden
      title={null}
      styles={{ body: { padding: 0 } }}
    >
      <LoginCard />
    </Modal>
  )
}
