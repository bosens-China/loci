import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber } from 'antd'
import { APP_SETTINGS_LIMITS, isValidBatchIntervalSeconds, type AppSettings } from '@loci/shared'
import { getSettings, saveSettings } from '@/api/settings'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { DataTransferPanel } from '@/components/DataTransferPanel'
import {
  ADMIN_JOBS_KEY,
  ADMIN_LIBRARIES_KEY,
  ADMIN_SESSION_KEY
} from '@/pages/admin/admin-query-keys'
import { HostnamePolicyPanel } from '@/pages/settings/HostnamePolicyPanel'

export function SettingsPage(): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<AppSettings>()
  const query = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  useEffect(() => {
    if (query.data) form.setFieldsValue(query.data)
  }, [form, query.data])
  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: (settings) => {
      const changedServer = settings.serverUrl !== query.data?.serverUrl
      const hadAdminSession = Boolean(client.getQueryData(ADMIN_SESSION_KEY))
      form.setFieldsValue(settings)
      client.setQueryData(['settings'], settings)
      if (changedServer) {
        client.setQueryData(ADMIN_SESSION_KEY, null)
        client.removeQueries({ queryKey: ADMIN_LIBRARIES_KEY })
        client.removeQueries({ queryKey: ADMIN_JOBS_KEY })
      }
      void message.success(
        changedServer && hadAdminSession ? '设置已保存，管理员会话已重置' : '设置已保存'
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="服务设置"
        description="CLI、Web UI、按需 worker 和定时任务共用同一份本机配置。"
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <Form form={form} layout="vertical" onFinish={(value) => save.mutate(value)}>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="panel p-5">
              <h2 className="mb-4 mt-0 text-base font-700">抓取并发</h2>
              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  name="httpConcurrency"
                  label="HTTP 并发"
                  {...APP_SETTINGS_LIMITS.concurrency}
                />
                <NumberField
                  name="browserConcurrency"
                  label="浏览器并发"
                  {...APP_SETTINGS_LIMITS.concurrency}
                />
                <NumberField
                  name="maxRetries"
                  label="失败重试"
                  {...APP_SETTINGS_LIMITS.maxRetries}
                />
                <NumberField
                  name="batchIntervalSeconds"
                  label="批次间隔最小（秒）"
                  min={0}
                  max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
                  batchInterval
                />
                <NumberField
                  name="batchIntervalMaxSeconds"
                  label="批次间隔最大（秒）"
                  min={0}
                  max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
                  batchInterval
                />
              </div>
            </section>
            <section className="panel p-5">
              <h2 className="mb-4 mt-0 text-base font-700">GitHub 体积限制</h2>
              <div className="grid grid-cols-2 gap-4">
                <NumberField
                  name="githubArchiveLimitMb"
                  label="仓库压缩包（MB）"
                  {...APP_SETTINGS_LIMITS.githubSizeMb}
                />
                <NumberField
                  name="githubMarkdownLimitMb"
                  label="Markdown 总量（MB）"
                  {...APP_SETTINGS_LIMITS.githubSizeMb}
                />
              </div>
            </section>
            <section className="panel p-5 lg:col-span-2">
              <h2 className="mb-1 mt-0 text-base font-700">云服务连接</h2>
              <p className="mb-4 mt-0 text-xs text-muted">
                用于云端目录、云端副本更新和管理员登录，与 GitHub 抓取限制无关。
              </p>
              <Form.Item
                name="serverUrl"
                label="云服务地址"
                rules={[
                  { required: true, message: '请输入云服务地址' },
                  { type: 'url', message: '请输入完整的 HTTP 或 HTTPS 地址' }
                ]}
              >
                <Input placeholder="https://loci.example.com" />
              </Form.Item>
            </section>
          </div>
          <div className="mt-5 flex items-center justify-between">
            <p className="mb-0 text-xs text-muted">Web 端口默认随机分配，仅监听 127.0.0.1。</p>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存设置
            </Button>
          </div>
        </Form>
        <HostnamePolicyPanel />
        <DataTransferPanel />
      </AsyncState>
    </div>
  )
}

function NumberField({
  name,
  label,
  min,
  max,
  batchInterval = false
}: {
  name: keyof AppSettings
  label: string
  min: number
  max: number
  batchInterval?: boolean
}): React.JSX.Element {
  const rules = batchInterval
    ? [
        { required: true },
        {
          validator: (_rule: unknown, value: unknown) =>
            isValidBatchIntervalSeconds(value)
              ? Promise.resolve()
              : Promise.reject(new Error('请输入 0，或 100 到 3000 之间的整数秒'))
        }
      ]
    : [{ required: true }]
  return (
    <Form.Item name={name} label={label} rules={rules}>
      <InputNumber min={min} max={max} className="w-full" />
    </Form.Item>
  )
}
