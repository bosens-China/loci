import { useEffect } from 'react'
import { SaveOutlined } from '@ant-design/icons'
import type { SaveServerCrawlSettingsInput, ServerCrawlSettings } from '@loci/shared'
import { SERVER_CRAWL_SETTINGS_LIMITS } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, InputNumber, Tag, Typography } from 'antd'
import { getAdminCrawlSettings, saveAdminCrawlSettings } from '@/api/admin'
import { AsyncState } from '@/components/AsyncState'

export const ADMIN_CRAWL_SETTINGS_KEY = ['admin', 'crawl-settings'] as const

export function AdminCrawlSettingsPanel(): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<SaveServerCrawlSettingsInput>()
  const query = useQuery({
    queryKey: ADMIN_CRAWL_SETTINGS_KEY,
    queryFn: getAdminCrawlSettings
  })
  const save = useMutation({
    mutationFn: saveAdminCrawlSettings,
    onSuccess: (settings) => {
      client.setQueryData(ADMIN_CRAWL_SETTINGS_KEY, settings)
      setFormValues(form, settings)
      void message.success('Server 抓取策略已保存')
    },
    onError: (error: Error) => {
      void query.refetch()
      void message.error(error.message)
    }
  })

  useEffect(() => {
    if (query.data) setFormValues(form, query.data)
  }, [form, query.data])

  const submit = (input: SaveServerCrawlSettingsInput): void => {
    save.mutate({
      maxConcurrentJobs: input.maxConcurrentJobs,
      revision: input.revision
    })
  }

  return (
    <AsyncState
      loading={query.isLoading}
      error={query.error instanceof Error ? query.error : null}
      onRetry={() => void query.refetch()}
    >
      <Form<SaveServerCrawlSettingsInput> form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="revision" hidden>
          <InputNumber />
        </Form.Item>
        <div className="space-y-4">
          <Alert
            type="info"
            showIcon
            title="同一域名任务始终串行"
            description="这是防止重复抓取和并发写入的安全约束，不随全局并行任务数变化。降低全局并发不会终止正在运行的任务，只限制后续任务进入运行态。"
          />
          <Card title="任务调度" extra={<Tag color="processing">后续调度生效</Tag>}>
            <Typography.Paragraph type="secondary" className="mb-4! text-xs">
              控制 Server 可以同时运行多少个不同域名的同步任务。
            </Typography.Paragraph>
            <SettingNumber
              name="maxConcurrentJobs"
              label="最大并行任务数"
              {...SERVER_CRAWL_SETTINGS_LIMITS.maxConcurrentJobs}
            />
          </Card>
          <div className="flex justify-end">
            <Button
              type="primary"
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={save.isPending}
            >
              保存全局策略
            </Button>
          </div>
        </div>
      </Form>
    </AsyncState>
  )
}

function SettingNumber(props: {
  name: keyof SaveServerCrawlSettingsInput
  label: string
  min: number
  max: number
}): React.JSX.Element {
  return (
    <Form.Item
      name={props.name}
      label={props.label}
      rules={[{ required: true, message: `请输入${props.label}` }]}
      className="mb-0"
    >
      <InputNumber min={props.min} max={props.max} precision={0} className="w-full" />
    </Form.Item>
  )
}

function setFormValues(
  form: ReturnType<typeof Form.useForm<SaveServerCrawlSettingsInput>>[0],
  settings: ServerCrawlSettings
): void {
  form.setFieldsValue({
    maxConcurrentJobs: settings.maxConcurrentJobs,
    revision: settings.revision
  })
}
