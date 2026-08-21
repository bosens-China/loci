import { CloudServerOutlined, LockOutlined } from '@ant-design/icons'
import { Button, Form, Input } from 'antd'
import type { CloudAdminLoginInput } from '@loci/shared'

export function AdminLoginPanel(props: {
  serverUrl: string
  submitting: boolean
  onSubmit: (input: CloudAdminLoginInput) => void
}): React.JSX.Element {
  return (
    <div className="mx-auto grid min-h-[560px] max-w-5xl grid-cols-[1.1fr_.9fr] overflow-hidden rounded-2xl border border-[#d8e0e0] bg-white shadow-sm">
      <section className="flex flex-col justify-between bg-shell p-10 text-white">
        <div>
          <div className="mb-12 flex items-center gap-3 text-[#b8cbcc]">
            <CloudServerOutlined className="text-xl text-[#6ed5dc]" />
            <span className="text-xs font-700 tracking-[.14em] uppercase">Loci control plane</span>
          </div>
          <h1 className="m-0 max-w-md font-serif text-4xl leading-tight">管理公开文档的发布边界</h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-[#b8cbcc]">
            本地文档不会上传。这里仅维护目标 Server 上的公开文档库、同步计划与发布任务。
          </p>
        </div>
        <div className="rounded-xl border border-white/12 bg-white/6 p-4">
          <div className="text-[10px] font-700 tracking-[.16em] text-[#8aa3a5] uppercase">
            目标 Server
          </div>
          <div className="mt-2 break-all font-mono text-sm text-white">{props.serverUrl}</div>
        </div>
      </section>
      <section className="flex items-center p-10">
        <div className="w-full">
          <h2 className="m-0 font-serif text-2xl">管理员登录</h2>
          <p className="mb-7 mt-2 text-sm text-muted">
            密码只用于本次登录，远程 Token 仅保存在本机 Runtime 内存。
          </p>
          <Form<CloudAdminLoginInput>
            layout="vertical"
            initialValues={{ username: 'admin' }}
            onFinish={props.onSubmit}
          >
            <Form.Item name="username" label="管理员账号" rules={[{ required: true }]}>
              <Input size="large" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password
                size="large"
                prefix={<LockOutlined />}
                autoComplete="current-password"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" block loading={props.submitting}>
              登录并进入管理界面
            </Button>
          </Form>
        </div>
      </section>
    </div>
  )
}
