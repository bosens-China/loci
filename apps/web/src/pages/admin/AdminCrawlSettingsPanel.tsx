import { useEffect } from 'react'
import { SaveOutlined } from '@ant-design/icons'
import type { SaveServerCrawlSettingsInput, ServerCrawlSettings } from '@loci/shared'
import {
  SERVER_CRAWL_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds
} from '@loci/shared'
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
    if (!isValidBatchIntervalRange(input.batchIntervalMinSeconds, input.batchIntervalMaxSeconds)) {
      form.setFields([{ name: 'batchIntervalMaxSeconds', errors: ['最大值不能小于最小值'] }])
      return
    }
    save.mutate(input)
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
          <Card title="任务内抓取默认值" extra={<Tag color="processing">下一批次生效</Tag>}>
            <Typography.Paragraph type="secondary" className="mb-4! text-xs">
              hostname 覆盖为空时继承这里的默认值；运行中的任务会在下一批次重新读取。
            </Typography.Paragraph>
            <div className="grid gap-4 lg:grid-cols-2">
              <SettingNumber
                name="httpConcurrency"
                label="HTTP 并发"
                {...SERVER_CRAWL_SETTINGS_LIMITS.concurrency}
              />
              <SettingNumber
                name="browserConcurrency"
                label="浏览器并发"
                {...SERVER_CRAWL_SETTINGS_LIMITS.concurrency}
              />
              <SettingNumber
                name="batchIntervalMinSeconds"
                label="批次间隔最小（秒）"
                min={0}
                max={SERVER_CRAWL_SETTINGS_LIMITS.batchIntervalSeconds.max}
                batchInterval
              />
              <SettingNumber
                name="batchIntervalMaxSeconds"
                label="批次间隔最大（秒）"
                min={0}
                max={SERVER_CRAWL_SETTINGS_LIMITS.batchIntervalSeconds.max}
                batchInterval
              />
            </div>
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
  batchInterval?: boolean
}): React.JSX.Element {
  return (
    <Form.Item
      name={props.name}
      label={props.label}
      rules={[
        { required: true, message: `请输入${props.label}` },
        ...(props.batchInterval
          ? [
              {
                validator: (_: unknown, value: unknown) =>
                  isValidBatchIntervalSeconds(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入 0 或允许范围内的整数'))
              }
            ]
          : [])
      ]}
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
    httpConcurrency: settings.httpConcurrency,
    browserConcurrency: settings.browserConcurrency,
    batchIntervalMinSeconds: settings.batchIntervalMinSeconds,
    batchIntervalMaxSeconds: settings.batchIntervalMaxSeconds,
    revision: settings.revision
  })
}
