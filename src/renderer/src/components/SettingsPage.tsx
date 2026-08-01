import {
  BgColorsOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DesktopOutlined,
  MoonOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  InputNumber,
  Segmented,
  Skeleton,
  Space,
  Tabs,
  Typography,
  message
} from 'antd'
import { useState } from 'react'
import type { AgentClient, AppSettings } from '@shared/api'
import { useAppSettings } from '@renderer/settings-context'

type SavingSection = 'agent' | 'crawl' | 'appearance'

function createAgentConfigs(endpoint: string): Array<{
  key: string
  label: string
  path: string
  content: string
  client?: AgentClient
}> {
  const json = (server: Record<string, string>): string =>
    JSON.stringify({ mcpServers: { loci: server } }, null, 2)

  return [
    {
      key: 'codex',
      label: 'Codex',
      path: '~/.codex/config.toml',
      content: `[mcp_servers.loci]\nurl = "${endpoint}"`,
      client: 'codex'
    },
    {
      key: 'cursor',
      label: 'Cursor',
      path: '~/.cursor/mcp.json',
      content: json({ url: endpoint }),
      client: 'cursor'
    },
    {
      key: 'vscode',
      label: 'VS Code',
      path: '用户配置 mcp.json',
      content: JSON.stringify({ servers: { loci: { type: 'http', url: endpoint } } }, null, 2),
      client: 'vscode'
    },
    {
      key: 'claude-code',
      label: 'Claude Code',
      path: '.mcp.json',
      content: json({ type: 'http', url: endpoint }),
      client: 'claude-code'
    },
    {
      key: 'gemini-cli',
      label: 'Gemini CLI',
      path: '~/.gemini/settings.json',
      content: json({ httpUrl: endpoint }),
      client: 'gemini-cli'
    },
    {
      key: 'antigravity',
      label: 'Google Antigravity',
      path: '~/.gemini/config/mcp_config.json',
      content: json({ serverUrl: endpoint })
    }
  ]
}

function SettingsPage(): React.JSX.Element {
  const [agentForm] = Form.useForm<Pick<AppSettings, 'mcpPort'>>()
  const [crawlForm] = Form.useForm<Pick<AppSettings, 'httpConcurrency' | 'browserConcurrency'>>()
  const [appearanceForm] = Form.useForm<Pick<AppSettings, 'theme'>>()
  const { state, loading, save } = useAppSettings()
  const [saving, setSaving] = useState<SavingSection | null>(null)
  const [importing, setImporting] = useState<AgentClient | null>(null)
  const [messageApi, contextHolder] = message.useMessage()
  const agentConfigs = createAgentConfigs(state.mcp.endpoint)

  const handleSave = (
    section: SavingSection,
    settings: Partial<AppSettings>,
    successMessage: string
  ): void => {
    setSaving(section)
    void save({ ...state.settings, ...settings })
      .then(() => {
        messageApi.success(successMessage)
      })
      .catch((error: unknown) => {
        messageApi.error(error instanceof Error ? error.message : '设置保存失败')
      })
      .finally(() => setSaving(null))
  }

  const handleImport = (client: AgentClient): void => {
    setImporting(client)
    void window.api
      .importAgentClient(client)
      .then((result) => messageApi.success(result.message))
      .catch((error: unknown) => {
        messageApi.error(error instanceof Error ? error.message : 'Agent 导入失败')
      })
      .finally(() => setImporting(null))
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {contextHolder}
      <div className="mb-6">
        <Typography.Title level={2}>设置</Typography.Title>
        <Typography.Paragraph type="secondary">
          管理本机 Agent 连接和 Loci 的显示方式。
        </Typography.Paragraph>
      </div>

      {loading ? (
        <Card variant="borderless">
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <Space direction="vertical" size="middle" className="w-full">
          <Card
            title={
              <Space>
                <CloudServerOutlined /> Agent 连接
              </Space>
            }
            extra={
              state.mcp.running ? (
                <Typography.Text type="success">
                  <CheckCircleOutlined /> 运行中
                </Typography.Text>
              ) : undefined
            }
          >
            <Form
              form={agentForm}
              layout="vertical"
              initialValues={{ mcpPort: state.settings.mcpPort }}
              onFinish={(settings) => handleSave('agent', settings, 'Agent 连接已保存并生效')}
            >
              <Typography.Paragraph type="secondary">
                MCP 服务只监听本机回环地址。保存新端口后，Agent 连接地址立即切换。
              </Typography.Paragraph>
              {state.mcp.error && (
                <Alert className="mb-4" type="error" showIcon message={state.mcp.error} />
              )}
              <Form.Item
                name="mcpPort"
                label="MCP 端口"
                rules={[
                  { required: true, message: '请输入端口号' },
                  {
                    type: 'number',
                    min: 1024,
                    max: 65535,
                    message: '请输入 1024 到 65535 之间的端口'
                  }
                ]}
              >
                <InputNumber className="w-full" min={1024} max={65535} addonBefore="127.0.0.1" />
              </Form.Item>
              <div className="mb-4 flex justify-end">
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving === 'agent'}
                  disabled={saving !== null && saving !== 'agent'}
                >
                  保存 Agent 连接
                </Button>
              </div>
              <Typography.Text type="secondary">当前地址</Typography.Text>
              <Typography.Paragraph copyable={{ text: state.mcp.endpoint }} className="mb-0! mt-1!">
                <Typography.Text code>{state.mcp.endpoint}</Typography.Text>
              </Typography.Paragraph>

              <Divider />
              <Typography.Title level={5}>添加到编辑器</Typography.Title>
              <Typography.Paragraph type="secondary">
                一键导入会写入用户配置；也可以复制下方片段手动配置。
              </Typography.Paragraph>
              <Tabs
                size="small"
                items={agentConfigs.map((config) => {
                  const client = config.client
                  return {
                    key: config.key,
                    label: config.label,
                    children: (
                      <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <Typography.Text type="secondary" className="font-mono text-xs">
                            {config.path}
                          </Typography.Text>
                          <Space size="small">
                            {client && (
                              <Button
                                size="small"
                                type="primary"
                                loading={importing === client}
                                disabled={importing !== null && importing !== client}
                                onClick={() => handleImport(client)}
                              >
                                一键导入
                              </Button>
                            )}
                            {!client && (
                              <Typography.Text type="secondary">手动配置</Typography.Text>
                            )}
                            <Typography.Text
                              copyable={{
                                text: config.content,
                                tooltips: ['复制配置', '已复制']
                              }}
                            >
                              复制
                            </Typography.Text>
                          </Space>
                        </div>
                        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6">
                          {config.content}
                        </pre>
                      </div>
                    )
                  }
                })}
              />
            </Form>
          </Card>

          <Card
            title={
              <Space>
                <DashboardOutlined /> 抓取默认值
              </Space>
            }
          >
            <Form
              form={crawlForm}
              layout="vertical"
              initialValues={{
                httpConcurrency: state.settings.httpConcurrency,
                browserConcurrency: state.settings.browserConcurrency
              }}
              onFinish={(settings) => handleSave('crawl', settings, '抓取默认值已保存')}
            >
              <Typography.Paragraph type="secondary">
                文档源没有单独设置并发时，按实际抓取方式使用这里的值。
              </Typography.Paragraph>
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                <Form.Item
                  name="httpConcurrency"
                  label="HTTP 并发"
                  rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
                >
                  <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
                </Form.Item>
                <Form.Item
                  name="browserConcurrency"
                  label="浏览器并发"
                  rules={[{ required: true, type: 'number', min: 1, max: 32 }]}
                >
                  <InputNumber min={1} max={32} className="w-full" addonAfter="页" />
                </Form.Item>
              </div>
              <div className="flex justify-end">
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving === 'crawl'}
                  disabled={saving !== null && saving !== 'crawl'}
                >
                  保存抓取默认值
                </Button>
              </div>
            </Form>
          </Card>

          <Card
            title={
              <Space>
                <BgColorsOutlined /> 外观
              </Space>
            }
          >
            <Form
              form={appearanceForm}
              layout="vertical"
              initialValues={{ theme: state.settings.theme }}
              onFinish={(settings) => handleSave('appearance', settings, '外观设置已保存')}
            >
              <Form.Item name="theme" label="主题" className="mb-0!">
                <Segmented
                  block
                  options={[
                    { value: 'auto', label: '跟随系统', icon: <DesktopOutlined /> },
                    { value: 'light', label: '浅色', icon: <BulbOutlined /> },
                    { value: 'dark', label: '深色', icon: <MoonOutlined /> }
                  ]}
                />
              </Form.Item>
              <div className="mt-4 flex justify-end">
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={saving === 'appearance'}
                  disabled={saving !== null && saving !== 'appearance'}
                >
                  保存外观
                </Button>
              </div>
            </Form>
          </Card>

        </Space>
      )}
    </div>
  )
}

export default SettingsPage
