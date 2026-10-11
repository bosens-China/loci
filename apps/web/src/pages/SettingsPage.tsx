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
import { APP_SETTINGS_LIMITS, type AppSettings } from '@loci/shared'
import { getSettings, saveSettings } from '@/api/settings'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { DataTransferPanel } from '@/components/DataTransferPanel'
import {
  ADMIN_JOBS_KEY,
  ADMIN_LIBRARIES_KEY,
  ADMIN_SESSION_KEY
} from '@/pages/admin/admin-query-keys'

/** 系统设置页面：集中管理连接、主题、GitHub 容量保护和数据备份 */
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
        <span className="flex items-center gap-2">
          <ControlOutlined />
          <span>基础与连接</span>
        </span>
      ),
      children: (
        <div className="w-full space-y-6 pt-2">
          <Card title="界面与外观">
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
            extra={
              <Typography.Text type="secondary" className="text-sm">
                用于云端文档库发现、快照拉取与管理员登录
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
            <Typography.Text type="secondary" className="text-sm">
              修改云服务地址后，当前的管理员登录会话将自动重置。
            </Typography.Text>
          </Card>

          <Alert
            type="info"
            showIcon
            message="本地服务运行安全说明"
            description="Loci 默认仅监听本机 127.0.0.1 端口，所有文档索引与抓取数据均保存在本地 SQLite 数据库中，保障代码与知识资产隐私。"
            className="text-sm"
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
        <span className="flex items-center gap-2">
          <ThunderboltOutlined />
          <span>容量保护</span>
        </span>
      ),
      children: (
        <div className="w-full space-y-6 pt-2">
          <Card title="GitHub 仓库抓取上限">
            <div className="flex flex-wrap gap-6 items-start">
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

          <div className="flex justify-end pt-2">
            <Button
              type="primary"
              icon={<SaveOutlined />}
              htmlType="submit"
              loading={save.isPending}
            >
              保存容量保护
            </Button>
          </div>
        </div>
      )
    },
    {
      key: 'data',
      label: (
        <span className="flex items-center gap-2">
          <DatabaseOutlined />
          <span>数据备份与迁移</span>
        </span>
      ),
      children: (
        <div className="w-full pt-2">
          <DataTransferPanel />
        </div>
      )
    }
  ]

  return (
    <div className="w-full px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader title="系统设置" description="管理连接、容量保护与本地数据备份。" />
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
  className = 'w-64'
}: {
  name: keyof AppSettings
  label: string
  min: number
  max: number
  unit?: string
  className?: string
}): React.JSX.Element {
  return (
    <Form.Item label={<span className="text-sm">{label}</span>} className={`mb-0 ${className}`}>
      <Space.Compact block>
        <Form.Item name={name} rules={[{ required: true }]} noStyle>
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
