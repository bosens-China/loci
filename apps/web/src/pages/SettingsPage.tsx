import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Select } from 'antd'
import { APP_SETTINGS_LIMITS, isValidBatchIntervalSeconds, type AppSettings } from '@loci/shared'
import { getSettings, saveSettings } from '@/api/settings'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { DataTransferPanel } from '@/components/DataTransferPanel'

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
      form.setFieldsValue(settings)
      client.setQueryData(['settings'], settings)
      void message.success('设置已保存')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  return (
    <>
      <PageHeader
        eyebrow="Runtime policy"
        title="服务设置"
        description="这些参数由后台服务统一读取，CLI、Web UI 和定时任务不会各自维护一份。"
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <Form form={form} layout="vertical" onFinish={(value) => save.mutate(value)}>
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="panel p-5 sm:p-6">
              <div className="eyebrow">Crawling</div>
              <h2 className="mb-5 mt-1 text-lg font-700">抓取并发</h2>
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
                  label="批次间隔（秒）"
                  min={0}
                  max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
                  batchInterval
                />
              </div>
            </section>
            <section className="panel p-5 sm:p-6">
              <div className="eyebrow">Limits</div>
              <h2 className="mb-5 mt-1 text-lg font-700">GitHub 体积限制</h2>
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
              <Form.Item name="serverUrl" label="云服务地址">
                <Input />
              </Form.Item>
            </section>
            <section className="panel p-5 sm:p-6 xl:col-span-2">
              <div className="eyebrow">Interface</div>
              <h2 className="mb-5 mt-1 text-lg font-700">界面与兼容端口</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Form.Item name="theme" label="主题">
                  <Select
                    options={[
                      { value: 'auto', label: '跟随系统' },
                      { value: 'light', label: '浅色' },
                      { value: 'dark', label: '深色' }
                    ]}
                  />
                </Form.Item>
                <NumberField name="mcpPort" label="MCP 端口" {...APP_SETTINGS_LIMITS.mcpPort} />
              </div>
              <div className="mt-2 rounded-xl bg-[#edf5f4] px-4 py-3 text-sm leading-6 text-[#466163]">
                后台服务的 Web 端口默认随机分配，只监听 127.0.0.1；这里的端口仅保留给 MCP
                兼容入口。修改后运行 loci service restart 生效。
              </div>
            </section>
          </div>
          <div className="mt-6 flex justify-end">
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存设置
            </Button>
          </div>
        </Form>
        <DataTransferPanel />
      </AsyncState>
    </>
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
