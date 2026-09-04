import { useEffect } from 'react'
import { Modal } from 'antd'
import { useKanban } from '../store'
import LoginForm from '../pages/LoginPage'
import { useUI } from '../ui'

/** readonly/open 模式未登录用户点击「登录/注册」时的弹窗。
 * 弹窗自身（antd Modal container）承担白底圆角容器，内部只放 LoginForm，
 * 避免「panel 内嵌 panel」造成的双层阴影与关闭按钮错位。 */
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
      width={400}
      destroyOnHidden
      title={null}
      centered
      maskClosable
      styles={{ body: { padding: '6px 4px 2px' } }}
    >
      <LoginForm />
    </Modal>
  )
}
