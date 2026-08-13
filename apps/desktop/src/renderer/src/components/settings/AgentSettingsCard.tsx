import { CheckCircleOutlined, CloudServerOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Divider, Form, InputNumber, Space, Tag, Typography } from 'antd'
import { useEffect } from 'react'
import {
  GENERIC_MCP_CONFIG_TARGET,
  LOCI_AGENT_INSTRUCTIONS,
  createMcpClientConfig,
  isAgentClient,
  isAgentGlobalRulesClient,
  listMcpClients,
  type AgentClient,
  type AgentGlobalRulesClient,
  type McpConfigTarget,
  type McpServerStatus
} from '@loci/shared'

function createAgentConfigs(endpoint: string): Array<{
  key: McpConfigTarget
  label: string
  path: string
  content: string
  client?: AgentClient
}> {
  const connection = { type: 'http', endpoint } as const
  const clients = listMcpClients().map((definition) => ({
    key: definition.id,
    label: definition.label,
    path: definition.configPath,
    content: createMcpClientConfig(definition.id, connection),
    client: isAgentClient(definition.id) ? definition.id : undefined
  }))
  return [
    ...clients,
    {
      key: GENERIC_MCP_CONFIG_TARGET.id,
      label: GENERIC_MCP_CONFIG_TARGET.label,
      path: GENERIC_MCP_CONFIG_TARGET.configPath,
      content: createMcpClientConfig(GENERIC_MCP_CONFIG_TARGET.id, connection)
    }
  ]
}

function createGlobalRulesConfigs(): Array<{
  key: string
  label: string
  path: string
  client?: AgentGlobalRulesClient
}> {
  return listMcpClients().map((definition) => ({
    key: definition.id,
    label: definition.label,
    path: definition.globalRulesPath,
    client: isAgentGlobalRulesClient(definition.id) ? definition.id : undefined
  }))
}

interface AgentSettingsCardProps {
  mcpPort: number
  mcpStatus: McpServerStatus
  saving: boolean
  onSavePort: (port: number) => void
  onImportAgent: (client: AgentClient) => void
  importingClient: AgentClient | null
  onInstallGlobalRules: (client: AgentGlobalRulesClient) => void
  installingGlobalRulesClient: AgentGlobalRulesClient | null
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
  importingClient,
  onInstallGlobalRules,
  installingGlobalRulesClient
}: AgentSettingsCardProps): React.JSX.Element {
  const [form] = Form.useForm<{ mcpPort: number }>()
  const agentConfigs = createAgentConfigs(mcpStatus.endpoint)
  const globalRulesConfigs = createGlobalRulesConfigs()

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
          配置用户级全局规则
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="text-xs mb-3">
          写入只会新增或替换 Loci 标记包围的区块，并保留文件中的其他个人规则。Cursor
          官方仅支持在设置中维护 User Rules，因此需要手动复制。
        </Typography.Paragraph>

        <div className="overflow-hidden rounded-lg border border-solid border-[var(--ant-color-border-secondary)]">
          {globalRulesConfigs.map((config) => {
            const client = config.client
            return (
              <div
                key={config.key}
                className="border-0 border-b border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4 last:border-b-0"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Space size="small" wrap>
                      <Typography.Text strong>{config.label}</Typography.Text>
                      <Tag color={client ? 'blue' : 'default'} bordered={false} className="m-0!">
                        {client ? '一键写入' : '手动复制'}
                      </Tag>
                    </Space>
                    <Typography.Text
                      type="secondary"
                      className="mt-1 block truncate font-mono text-xs"
                    >
                      {config.path}
                    </Typography.Text>
                  </div>
                  <Space size="small" wrap>
                    {client && (
                      <Button
                        size="small"
                        type="primary"
                        loading={installingGlobalRulesClient === client}
                        disabled={
                          installingGlobalRulesClient !== null &&
                          installingGlobalRulesClient !== client
                        }
                        onClick={() => onInstallGlobalRules(client)}
                      >
                        写入全局规则
                      </Button>
                    )}
                    <Typography.Text
                      className="cursor-pointer text-xs text-primary"
                      copyable={{
                        text: LOCI_AGENT_INSTRUCTIONS,
                        tooltips: ['复制规则', '已复制']
                      }}
                    >
                      复制规则
                    </Typography.Text>
                  </Space>
                </div>
              </div>
            )
          })}
        </div>

        <Divider />

        <Typography.Title level={5} className="mt-0! mb-1!">
          集成到 Agent 编辑器
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="text-xs mb-3">
          桌面端统一使用上方 HTTP
          Endpoint；一键配置会优先调用客户端命令，命令失败或不支持时安全合并用户配置文件。
        </Typography.Paragraph>

        <div className="overflow-hidden rounded-lg border border-solid border-[var(--ant-color-border-secondary)]">
          {agentConfigs.map((config) => {
            const client = config.client
            return (
              <div
                key={config.key}
                className="border-0 border-b border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4 last:border-b-0"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Space size="small" wrap>
                      <Typography.Text strong>{config.label}</Typography.Text>
                      <Tag color={client ? 'blue' : 'default'} bordered={false} className="m-0!">
                        {client ? '一键配置' : '手动复制'}
                      </Tag>
                      <Tag bordered={false} className="m-0!">
                        HTTP
                      </Tag>
                    </Space>
                    <Typography.Text
                      type="secondary"
                      className="mt-1 block truncate font-mono text-xs"
                    >
                      {config.path}
                    </Typography.Text>
                  </div>
                  <Space size="small" wrap>
                    {client && (
                      <Button
                        size="small"
                        type="primary"
                        loading={importingClient === client}
                        disabled={importingClient !== null && importingClient !== client}
                        onClick={() => onImportAgent(client)}
                      >
                        一键写入
                      </Button>
                    )}
                    <Typography.Text
                      className="cursor-pointer text-xs text-primary"
                      copyable={{
                        text: config.content,
                        tooltips: ['复制配置', '已复制']
                      }}
                    >
                      复制配置
                    </Typography.Text>
                  </Space>
                </div>
                <details className="mt-3 text-xs">
                  <summary className="w-fit cursor-pointer text-[var(--ant-color-text-secondary)]">
                    查看配置片段
                  </summary>
                  <pre className="mb-0 mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--ant-color-fill-secondary)] p-3 font-mono text-xs leading-6 text-[var(--ant-color-text)]">
                    {config.content}
                  </pre>
                </details>
              </div>
            )
          })}
        </div>
      </Form>
    </Card>
  )
}
