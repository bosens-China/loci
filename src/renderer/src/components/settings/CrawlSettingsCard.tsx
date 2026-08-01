import { DashboardOutlined } from '@ant-design/icons'
import { Button, Card, Form, InputNumber, Space, Typography } from 'antd'
import { useEffect } from 'react'

interface CrawlSettingsCardProps {
  httpConcurrency: number
  browserConcurrency: number
  saving: boolean
  onSave: (concurrency: { httpConcurrency: number; browserConcurrency: number }) => void
}

/**
 * 抓取默认并发设置卡片
 */
export function CrawlSettingsCard({
  httpConcurrency,
  browserConcurrency,
  saving,
  onSave
}: CrawlSettingsCardProps): React.JSX.Element {
  const [form] = Form.useForm<{ httpConcurrency: number; browserConcurrency: number }>()

  useEffect(() => {
    form.setFieldsValue({ httpConcurrency, browserConcurrency })
  }, [browserConcurrency, form, httpConcurrency])

  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <Space>
          <DashboardOutlined className="text-primary" />
          <span>抓取默认并发</span>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ httpConcurrency, browserConcurrency }}
        onFinish={onSave}
      >
        <Typography.Paragraph type="secondary" className="text-xs">
          当单个文档源没有独立设置并发上限时，系统将默认采用此处设定的全局并发配置。
        </Typography.Paragraph>

        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 mb-4">
          <Form.Item
            name="httpConcurrency"
            label="HTTP 直取并发上限"
            rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
          >
            <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
          </Form.Item>

          <Form.Item
            name="browserConcurrency"
            label="无头浏览器并发上限"
            rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
          >
            <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
          </Form.Item>
        </div>

        <div className="flex justify-end">
          <Button type="primary" htmlType="submit" loading={saving}>
            保存抓取并发配置
          </Button>
        </div>
      </Form>
    </Card>
  )
}
