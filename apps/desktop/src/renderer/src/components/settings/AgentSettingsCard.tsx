import { CheckCircleOutlined, CloudServerOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Divider, Form, InputNumber, Space, Tabs, Typography } from 'antd'
import { useEffect } from 'react'
import type { AgentClient, McpServerStatus } from '@loci/shared'

const SKILL_INSTALL_COMMAND = 'npx skills add bosens-China/dochub-mcp --skill use-loci -y'

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

interface AgentSettingsCardProps {
  mcpPort: number
  mcpStatus: McpServerStatus
  saving: boolean
  onSavePort: (port: number) => void
  onImportAgent: (client: AgentClient) => void
  importingClient: AgentClient | null
}

/**
 * Agent 连接与 MCP 端口设置卡片
 */
export function AgentSettingsCard({
  mcpPort,
  mcpStatus,
  saving,
  onSavePort,
  onImportAgent,
  importingClient
}: AgentSettingsCardProps): React.JSX.Element {
  const [form] = Form.useForm<{ mcpPort: number }>()
  const agentConfigs = createAgentConfigs(mcpStatus.endpoint)

  useEffect(() => {
    form.setFieldsValue({ mcpPort })
  }, [form, mcpPort])

  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <Space>
          <CloudServerOutlined className="text-primary" />
          <span>Agent 连接配置 (MCP)</span>
        </Space>
      }
      extra={
        mcpStatus.running ? (
          <Typography.Text type="success" className="flex items-center gap-1 text-xs">
            <CheckCircleOutlined /> MCP 正常运行中
          </Typography.Text>
        ) : undefined
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ mcpPort }}
        onFinish={(values) => onSavePort(values.mcpPort)}
      >
        <Typography.Paragraph type="secondary" className="text-xs">
          Loci MCP 服务仅绑定本机回环地址 (`127.0.0.1`)。端口更新后，本地 Agent 可通过 HTTP
          建立连接。
        </Typography.Paragraph>

        {mcpStatus.error && (
          <Alert className="mb-4 rounded-lg" type="error" showIcon message={mcpStatus.error} />
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3 mb-4">
          <Form.Item
            name="mcpPort"
            label="MCP 服务端口"
            className="m-0! flex-1 w-full"
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

          <Button type="primary" htmlType="submit" loading={saving}>
            保存并启动新端口
          </Button>
        </div>

        <div className="p-3 rounded-lg bg-[var(--ant-color-fill-quaternary)] border border-solid border-[var(--ant-color-border-secondary)] mb-6">
          <Typography.Text type="secondary" className="text-xs block mb-1">
            当前本地 MCP 节点 Endpoint:
          </Typography.Text>
          <Typography.Paragraph
            copyable={{ text: mcpStatus.endpoint }}
            className="m-0! font-mono text-xs"
          >
            <Typography.Text code className="text-xs">
              {mcpStatus.endpoint}
            </Typography.Text>
          </Typography.Paragraph>
        </div>

        <Divider />

        <Typography.Title level={5} className="mt-0! mb-1!">
          集成到 Agent 编辑器
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="text-xs mb-3">
          支持向常用 AI 编程编辑器一键写入 MCP 配置文件，或手动复制片段。
        </Typography.Paragraph>

        <Tabs
          size="small"
          type="card"
          items={agentConfigs.map((config) => {
            const client = config.client
            return {
              key: config.key,
              label: config.label,
              children: (
                <div className="rounded-lg border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Typography.Text type="secondary" className="font-mono text-xs truncate">
                      {config.path}
                    </Typography.Text>
                    <Space size="small">
                      {client && (
                        <Button
                          size="small"
                          type="primary"
                          loading={importingClient === client}
                          disabled={importingClient !== null && importingClient !== client}
                          onClick={() => onImportAgent(client)}
                        >
                          一键写入配置
                        </Button>
                      )}
                      {!client && (
                        <Typography.Text type="secondary" className="text-xs">
                          手动配置
                        </Typography.Text>
                      )}
                      <Typography.Text
                        className="text-xs text-primary cursor-pointer"
                        copyable={{
                          text: config.content,
                          tooltips: ['复制片段', '已复制']
                        }}
                      >
                        复制
                      </Typography.Text>
                    </Space>
                  </div>
                  <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-[var(--ant-color-text)]">
                    {config.content}
                  </pre>
                </div>
              )
            }
          })}
        />

        <Divider />

        <Typography.Title level={5} className="mt-0! mb-1!">
          安装 Loci Agent Skill
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="text-xs mb-2">
          在控制台运行下方命令，即可一键为当前项目配置 Loci 专用工具集：
        </Typography.Paragraph>
        <div className="p-3 rounded-lg bg-[var(--ant-color-fill-quaternary)] border border-solid border-[var(--ant-color-border-secondary)] flex items-center justify-between">
          <Typography.Text code className="font-mono text-xs m-0">
            {SKILL_INSTALL_COMMAND}
          </Typography.Text>
          <Typography.Text
            className="text-xs text-primary cursor-pointer shrink-0"
            copyable={{ text: SKILL_INSTALL_COMMAND, tooltips: ['复制命令', '已复制'] }}
          >
            复制命令
          </Typography.Text>
        </div>
      </Form>
    </Card>
  )
}
