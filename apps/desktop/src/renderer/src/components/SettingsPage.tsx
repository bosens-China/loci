import {
  BgColorsOutlined,
  CloudServerOutlined,
  SafetyCertificateOutlined,
  CodeOutlined,
  DashboardOutlined,
  HddOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { Card, Skeleton, Tabs, Typography, message } from 'antd'
import { useState } from 'react'
import type { AgentClient, AppSettings, ThemeMode } from '@loci/shared'
import { useAppSettings } from '../settings-context'
import DataManagementCard from './DataManagementCard'
import { AboutSettingsCard } from './settings/AboutSettingsCard'
import { AgentSettingsCard } from './settings/AgentSettingsCard'
import { AppearanceSettingsCard } from './settings/AppearanceSettingsCard'
import { CrawlSettingsCard } from './settings/CrawlSettingsCard'
import { GeneralSettingsCard } from './settings/GeneralSettingsCard'
import { CloudAdminSettingsCard } from './settings/CloudAdminSettingsCard'

type SavingSection = 'agent' | 'crawl' | 'appearance'

function SettingsPage(): React.JSX.Element {
  const { state, loading, save } = useAppSettings()
  const [saving, setSaving] = useState<SavingSection | null>(null)
  const [importing, setImporting] = useState<AgentClient | null>(null)
  const [activeTab, setActiveTab] = useState('general')
  const [messageApi, contextHolder] = message.useMessage()

  const handleSavePartial = (
    section: SavingSection,
    partialSettings: Partial<AppSettings>,
    successMessage: string
  ): void => {
    setSaving(section)
    void save({ ...state.settings, ...partialSettings })
      .then(() => messageApi.success(successMessage))
      .catch((error: unknown) => {
        messageApi.error(error instanceof Error ? error.message : '设置保存失败')
      })
      .finally(() => setSaving(null))
  }

  const handleImportAgent = (client: AgentClient): void => {
    setImporting(client)
    void window.api
      .importAgentClient(client)
      .then((result) => messageApi.success(result.message))
      .catch((error: unknown) => {
        messageApi.error(error instanceof Error ? error.message : 'Agent 导入失败')
      })
      .finally(() => setImporting(null))
  }

  const tabItems = [
    {
      key: 'general',
      label: (
        <span className="flex items-center gap-2">
          <SettingOutlined /> 通用设置
        </span>
      ),
      children: <GeneralSettingsCard />
    },
    {
      key: 'agent',
      label: (
        <span className="flex items-center gap-2">
          <CloudServerOutlined /> Agent 连接
        </span>
      ),
      children: (
        <AgentSettingsCard
          mcpPort={state.settings.mcpPort}
          mcpStatus={state.mcp}
          saving={saving === 'agent'}
          onSavePort={(mcpPort) =>
            handleSavePartial('agent', { mcpPort }, 'Agent 连接配置已保存并重载生效')
          }
          onImportAgent={handleImportAgent}
          importingClient={importing}
        />
      )
    },
    {
      key: 'crawl',
      label: (
        <span className="flex items-center gap-2">
          <DashboardOutlined /> 抓取默认值
        </span>
      ),
      children: (
        <CrawlSettingsCard
          httpConcurrency={state.settings.httpConcurrency}
          browserConcurrency={state.settings.browserConcurrency}
          saving={saving === 'crawl'}
          onSave={(concurrency) =>
            handleSavePartial('crawl', concurrency, '抓取默认并发配置已保存')
          }
        />
      )
    },
    {
      key: 'appearance',
      label: (
        <span className="flex items-center gap-2">
          <BgColorsOutlined /> 外观设置
        </span>
      ),
      children: (
        <AppearanceSettingsCard
          theme={state.settings.theme}
          saving={saving === 'appearance'}
          onSave={(theme: ThemeMode) =>
            handleSavePartial('appearance', { theme }, '外观显示设置已保存')
          }
        />
      )
    },
    {
      key: 'cloud-admin',
      label: (
        <span className="flex items-center gap-2">
          <SafetyCertificateOutlined /> 云端服务
        </span>
      ),
      children: <CloudAdminSettingsCard />
    },
    {
      key: 'data',
      label: (
        <span className="flex items-center gap-2">
          <HddOutlined /> 数据管理
        </span>
      ),
      children: <DataManagementCard />
    },
    {
      key: 'about',
      label: (
        <span className="flex items-center gap-2">
          <CodeOutlined /> 关于 Loci
        </span>
      ),
      children: <AboutSettingsCard />
    }
  ]

  return (
    <div className="mx-auto h-full w-full max-w-5xl overflow-x-hidden overflow-y-auto pr-1">
      {contextHolder}
      <div className="mb-6">
        <Typography.Title level={2}>系统设置</Typography.Title>
        <Typography.Paragraph type="secondary">
          管理应用启动、本机 Agent 连接、抓取默认参数与显示外观。
        </Typography.Paragraph>
      </div>

      {loading ? (
        <Card variant="borderless">
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <div className="rounded-2xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-6 shadow-sm">
          <Tabs
            tabPosition="left"
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabItems}
            className="settings-tabs min-h-[460px]"
          />
        </div>
      )}
    </div>
  )
}

export default SettingsPage
