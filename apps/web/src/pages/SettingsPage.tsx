import { useEffect, useState } from 'react'
import {
  CloudOutlined,
  ControlOutlined,
  DatabaseOutlined,
  SaveOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Segmented,
  Space,
  Tabs,
  Typography
} from 'antd'
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
  const [activeTab, setActiveTab] = useState('basic')
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

  const tabItems = [
    {
      key: 'basic',
      label: (
        <span className="flex items-center gap-1.5">
          <ControlOutlined />
          <span>基础与连接</span>
        </span>
      ),
      children: (
        <div className="w-full space-y-5">
          <Card title="界面与外观" size="small">
            <Form.Item name="theme" label="界面主题" className="mb-0">
              <Segmented
                options={[
                  { label: '跟随系统', value: 'auto' },
                  { label: '浅色模式', value: 'light' },
                  { label: '深色模式', value: 'dark' }
                ]}
              />
            </Form.Item>
          </Card>

          <Card
            title="云服务连接"
            size="small"
            extra={
              <Typography.Text type="secondary" className="text-xs">
                用于云端目录发现、快照拉取与管理员登录
              </Typography.Text>
            }
          >
            <Form.Item
              name="serverUrl"
              label="Loci 云服务地址"
              rules={[
                { required: true, message: '请输入云服务地址' },
                { type: 'url', message: '请输入完整的 HTTP 或 HTTPS 地址' }
              ]}
              className="mb-2"
            >
              <Input
                prefix={<CloudOutlined className="text-[var(--ant-color-text-secondary)]" />}
                placeholder="https://loci.example.com"
              />
            </Form.Item>
            <Typography.Text type="secondary" className="text-xs">
              修改云服务地址后，当前的管理员登录会话将自动重置。
            </Typography.Text>
          </Card>

          <Alert
            type="info"
            showIcon
            title="本地服务环境安全说明"
            description="Loci 仅监听本机的 127.0.0.1 端口，所有文档索引与抓取数据均保存在本地 SQLite 数据库中，保障您的代码与文档隐私。"
          />

          <div className="flex justify-end pt-2">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={save.isPending}
            >
              保存基础设置
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'crawl',
      label: (
        <span className="flex items-center gap-1.5">
          <ThunderboltOutlined />
          <span>抓取与并发策略</span>
        </span>
      ),
      children: (
        <div className="w-full space-y-5">
          <Card title="全局抓取并发与频率" size="small">
            <div className="space-y-4">
              <div>
                <Typography.Text
                  strong
                  className="block text-xs text-[var(--ant-color-text-secondary)] mb-3"
                >
                  并发与重试控制
                </Typography.Text>
                <div className="flex flex-wrap gap-6 items-start">
                  <NumberField
                    name="httpConcurrency"
                    label="HTTP 请求并发数"
                    unit="个"
                    {...APP_SETTINGS_LIMITS.concurrency}
                  />
                  <NumberField
                    name="browserConcurrency"
                    label="浏览器无头渲染并发"
                    unit="个"
                    {...APP_SETTINGS_LIMITS.concurrency}
                  />
                  <NumberField
                    name="maxRetries"
                    label="单页面失败最大重试"
                    unit="次"
                    {...APP_SETTINGS_LIMITS.maxRetries}
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--ant-color-border-secondary)]">
                <Typography.Text
                  strong
                  className="block text-xs text-[var(--ant-color-text-secondary)] mb-3"
                >
                  批次请求间隔
                </Typography.Text>
                <div className="flex flex-wrap gap-6 items-start">
                  <NumberField
                    name="batchIntervalSeconds"
                    label="批次间隔最小（秒）"
                    unit="秒"
                    min={0}
                    max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
                    batchInterval
                  />
                  <NumberField
                    name="batchIntervalMaxSeconds"
                    label="批次间隔最大（秒）"
                    unit="秒"
                    min={0}
                    max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
                    batchInterval
                  />
                </div>
              </div>
            </div>
          </Card>

          <Card title="GitHub 仓库体积上限" size="small">
            <div className="flex flex-wrap gap-6 items-start">
              <NumberField
                name="githubArchiveLimitMb"
                label="仓库压缩包限制"
                unit="MB"
                {...APP_SETTINGS_LIMITS.githubSizeMb}
              />
              <NumberField
                name="githubMarkdownLimitMb"
                label="Markdown/MDX 提取总量限制"
                unit="MB"
                {...APP_SETTINGS_LIMITS.githubSizeMb}
              />
            </div>
          </Card>

          <div className="flex justify-end pt-2">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={save.isPending}
            >
              保存全局抓取策略
            </Button>
          </div>

          <HostnamePolicyPanel />
        </div>
      )
    },
    {
      key: 'data',
      label: (
        <span className="flex items-center gap-1.5">
          <DatabaseOutlined />
          <span>数据备份与迁移</span>
        </span>
      ),
      children: (
        <div className="w-full">
          <DataTransferPanel />
        </div>
      )
    }
  ]

  return (
    <div className="w-full px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="系统设置"
        description="管理本地服务、抓取与并发限速策略、以及本地 SQLite 数据的备份与恢复。"
      />
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
  unit,
  className = 'w-60',
  batchInterval = false
}: {
  name: keyof AppSettings
  label: string
  min: number
  max: number
  unit?: string
  className?: string
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
    <Form.Item label={label} className={`mb-0 ${className}`}>
      <Space.Compact block>
        <Form.Item name={name} rules={rules} noStyle>
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
