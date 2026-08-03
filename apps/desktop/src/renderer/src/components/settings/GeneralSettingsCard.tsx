import { PoweroffOutlined } from '@ant-design/icons'
import { Alert, Card, Space, Switch, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import type { OpenAtLoginState } from '@shared/api'

/** 操作系统级通用设置。 */
export function GeneralSettingsCard(): React.JSX.Element {
  const [state, setState] = useState<OpenAtLoginState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    void window.api
      .getOpenAtLogin()
      .then(setState)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '无法读取开机自启状态')
      )
  }, [])

  const handleChange = async (enabled: boolean): Promise<void> => {
    setSaving(true)
    try {
      const next = await window.api.setOpenAtLogin(enabled)
      setState(next)
      if (next.enabled === enabled) {
        messageApi.success(enabled ? '已开启开机自启' : '已关闭开机自启')
      } else {
        messageApi.warning('系统未接受更改，请在系统启动项设置中确认')
      }
    } catch (reason) {
      messageApi.error(reason instanceof Error ? reason.message : '开机自启设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <Space>
          <PoweroffOutlined className="text-primary" />
          <span>启动设置</span>
        </Space>
      }
    >
      {contextHolder}
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : (
        <div className="flex items-center justify-between gap-6">
          <div>
            <Typography.Text strong>开机自动启动 Loci</Typography.Text>
            <Typography.Paragraph type="secondary" className="mb-0! mt-1! text-xs">
              {state?.supported === false
                ? '当前平台或开发模式不支持此设置。'
                : '登录系统后自动启动应用，可随时关闭。'}
            </Typography.Paragraph>
          </div>
          <Switch
            aria-label="开机自动启动 Loci"
            checked={state?.enabled ?? false}
            loading={state === null || saving}
            disabled={state?.supported === false || saving}
            onChange={(enabled) => void handleChange(enabled)}
          />
        </div>
      )}
    </Card>
  )
}
