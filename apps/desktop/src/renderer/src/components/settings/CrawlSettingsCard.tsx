import { DashboardOutlined } from '@ant-design/icons'
import { Button, Card, Form, InputNumber, Space, Typography } from 'antd'
import { useEffect } from 'react'

interface CrawlSettingsCardProps {
  httpConcurrency: number
  browserConcurrency: number
  maxRetries: number
  batchIntervalSeconds: number
  githubArchiveLimitMb: number
  githubMarkdownLimitMb: number
  saving: boolean
  onSave: (settings: CrawlSettingsForm) => void
}

interface CrawlSettingsForm {
  httpConcurrency: number
  browserConcurrency: number
  maxRetries: number
  batchIntervalSeconds: number
  githubArchiveLimitMb: number
  githubMarkdownLimitMb: number
}

/**
 * 抓取默认参数设置卡片
 */
export function CrawlSettingsCard({
  httpConcurrency,
  browserConcurrency,
  maxRetries,
  batchIntervalSeconds,
  githubArchiveLimitMb,
  githubMarkdownLimitMb,
  saving,
  onSave
}: CrawlSettingsCardProps): React.JSX.Element {
  const [form] = Form.useForm<CrawlSettingsForm>()

  useEffect(() => {
    form.setFieldsValue({
      httpConcurrency,
      browserConcurrency,
      maxRetries,
      batchIntervalSeconds,
      githubArchiveLimitMb,
      githubMarkdownLimitMb
    })
  }, [
    batchIntervalSeconds,
    browserConcurrency,
    form,
    githubArchiveLimitMb,
    githubMarkdownLimitMb,
    httpConcurrency,
    maxRetries
  ])

  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <Space>
          <DashboardOutlined className="text-primary" />
          <span>抓取默认参数</span>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          httpConcurrency,
          browserConcurrency,
          maxRetries,
          batchIntervalSeconds,
          githubArchiveLimitMb,
          githubMarkdownLimitMb
        }}
        onFinish={onSave}
      >
        <Typography.Paragraph type="secondary" className="text-xs">
          文档源未单独覆盖并发时使用这里的全局参数；重试和批次间隔对所有抓取生效。
        </Typography.Paragraph>

        <div className="mb-4 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <Form.Item
            name="httpConcurrency"
            label="HTTP 直取并发上限"
            rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
          >
            <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
          </Form.Item>

          <Form.Item
            name="githubArchiveLimitMb"
            label="GitHub ZIP 默认上限"
            rules={[{ required: true, type: 'number', min: 1, max: 10240 }]}
          >
            <InputNumber min={1} max={10240} className="w-full" addonAfter="MB" />
          </Form.Item>

          <Form.Item
            name="githubMarkdownLimitMb"
            label="GitHub Markdown 默认上限"
            rules={[{ required: true, type: 'number', min: 1, max: 10240 }]}
          >
            <InputNumber min={1} max={10240} className="w-full" addonAfter="MB" />
          </Form.Item>

          <Form.Item
            name="browserConcurrency"
            label="无头浏览器并发上限"
            rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
          >
            <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
          </Form.Item>

          <Form.Item
            name="maxRetries"
            label="失败重试次数"
            rules={[{ required: true, type: 'number', min: 0, max: 10 }]}
          >
            <InputNumber min={0} max={10} className="w-full" suffix="次" />
          </Form.Item>

          <Form.Item
            name="batchIntervalSeconds"
            label="批次间隔"
            extra="每批并发请求结束后等待；0 表示不等待"
            rules={[
              {
                validator: (_, value: number | undefined) =>
                  value === 0 || (value !== undefined && value >= 100 && value <= 3000)
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入 0，或 100-3000 秒'))
              }
            ]}
          >
            <InputNumber min={0} max={3000} className="w-full" suffix="秒" />
          </Form.Item>
        </div>

        <div className="flex justify-end">
          <Button type="primary" htmlType="submit" loading={saving}>
            保存抓取默认值
          </Button>
        </div>
      </Form>
    </Card>
  )
}
