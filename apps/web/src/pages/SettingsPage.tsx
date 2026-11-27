import { useEffect, useState } from 'react'
import {
  DatabaseOutlined,
  GlobalOutlined,
  SearchOutlined,
  SaveOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Form, InputNumber, Segmented, Space, Tabs } from 'antd'
import { APP_SETTINGS_LIMITS, type AppSettings } from '@loci/shared'
import { getSettings, saveSettings } from '@/api/settings'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { DataTransferPanel } from '@/components/DataTransferPanel'
import { ClearDataPanel } from '@/components/ClearDataPanel'
import { HostnamePoliciesPanel } from '@/pages/settings/HostnamePoliciesPanel'
import { EmbeddingModelsPanel } from '@/pages/settings/EmbeddingModelsPanel'

/** 系统设置页面：管理本地抓取并发、容量保护、域名策略与数据备份。 */
export function SettingsPage(): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [activeTab, setActiveTab] = useState('concurrency')
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

  const tabItems = [
    {
      key: 'concurrency',
      label: (
        <span className="flex items-center gap-2">
          <ThunderboltOutlined />
          <span>抓取与并发</span>
        </span>
      ),
      children: (
        <div className="w-full space-y-5 pt-2">
          <Card title="界面外观">
            <Form.Item name="theme" label="色彩主题" className="mb-0">
              <Segmented
                options={[
                  { label: '跟随系统', value: 'auto' },
                  { label: '浅色模式', value: 'light' },
                  { label: '深色模式', value: 'dark' }
                ]}
              />
            </Form.Item>
          </Card>

          <Card title="全局抓取并发与间隔">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField
                name="httpConcurrency"
                label="HTTP 请求并发数"
                min={APP_SETTINGS_LIMITS.concurrency.min}
                max={APP_SETTINGS_LIMITS.concurrency.max}
              />
              <NumberField name="browserConcurrency" label="浏览器渲染并发数" min={1} max={10} />
              <NumberField
                name="maxRetries"
                label="请求失败重试次数"
                min={APP_SETTINGS_LIMITS.maxRetries.min}
                max={APP_SETTINGS_LIMITS.maxRetries.max}
              />
              <NumberField
                name="batchIntervalSeconds"
                label="批次最小间隔（0 为禁用）"
                unit="秒"
                min={0}
                max={3000}
              />
              <NumberField
                name="batchIntervalMaxSeconds"
                label="批次最大间隔（0 为禁用）"
                unit="秒"
                min={0}
                max={3000}
              />
            </div>
          </Card>

          <Card title="GitHub 保护上限">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumberField
                name="githubArchiveLimitMb"
                label="仓库压缩包体积上限"
                unit="MB"
                {...APP_SETTINGS_LIMITS.githubSizeMb}
              />
              <NumberField
                name="githubMarkdownLimitMb"
                label="Markdown 提取总量上限"
                unit="MB"
                {...APP_SETTINGS_LIMITS.githubSizeMb}
              />
            </div>
          </Card>

          <Alert
            type="info"
            showIcon
            message="本地隐私与服务安全"
            description="Loci 仅监听本机 127.0.0.1 回环地址。文档、索引和搜索均在本机处理。"
          />

          <div className="flex justify-end pt-2">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={save.isPending}
            >
              保存配置
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'hostname',
      label: (
        <span className="flex items-center gap-2">
          <GlobalOutlined />
          <span>域名策略</span>
        </span>
      ),
      children: (
        <div className="w-full pt-2">
          <HostnamePoliciesPanel />
        </div>
      )
    },
    {
      key: 'models',
      label: (
        <span className="flex items-center gap-2">
          <SearchOutlined />
          <span>检索模型</span>
        </span>
      ),
      children: <EmbeddingModelsPanel />
    },
    {
      key: 'data',
      label: (
        <span className="flex items-center gap-2">
          <DatabaseOutlined />
          <span>数据备份与恢复</span>
        </span>
      ),
      children: (
        <div className="w-full space-y-4 pt-2">
          <DataTransferPanel />
          <ClearDataPanel />
        </div>
      )
    }
  ]

  return (
    <div className="w-full px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader title="设置与数据" description="管理本地抓取并发、域名策略与数据备份。" />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <Form form={form} layout="vertical" onFinish={(value) => save.mutate(value)}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            type="card"
            className="mb-4"
          />
        </Form>
      </AsyncState>
    </div>
  )
}

function NumberField({
  name,
  label,
  min,
  max,
  unit
}: {
  name: keyof AppSettings
  label: string
  min: number
  max: number
  unit?: string
}): React.JSX.Element {
  return (
    <Form.Item label={<span className="text-xs font-medium">{label}</span>} className="mb-0">
      <Space.Compact block>
        <Form.Item name={name} rules={[{ required: true, message: '请输入数值' }]} noStyle>
          <InputNumber min={min} max={max} className="w-full" />
        </Form.Item>
        {unit ? (
          <Button disabled className="pointer-events-none">
            {unit}
          </Button>
        ) : null}
      </Space.Compact>
    </Form.Item>
  )
}
