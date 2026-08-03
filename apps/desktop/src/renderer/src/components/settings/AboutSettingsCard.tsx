import { CodeOutlined, GithubOutlined } from '@ant-design/icons'
import { Card, Space, Typography } from 'antd'

/**
 * 关于 Loci 与快捷键说明卡片
 */
export function AboutSettingsCard(): React.JSX.Element {
  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={
        <Space>
          <CodeOutlined className="text-primary" />
          <span>关于 Loci</span>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" className="w-full">
        <Typography.Paragraph className="mb-0 text-sm">
          Loci 是一款面向 AI Agent 的本地文档索引与知识库系统。用户提供公开文档 URL
          后，应用自动解析并转换为 Markdown，保存在本机，并通过内建 MCP 协议与 AI 编程工具直接对话。
        </Typography.Paragraph>

        <div className="p-4 rounded-xl bg-[var(--ant-color-fill-quaternary)] border border-solid border-[var(--ant-color-border-secondary)]">
          <Typography.Text strong className="block mb-2 text-xs">
            开发者调试工具 (DevTools) 快捷键：
          </Typography.Text>
          <div className="space-y-1 font-mono text-xs text-gray-500">
            <div>
              Windows / Linux: <Typography.Text code>Ctrl + Shift + I</Typography.Text>
            </div>
            <div>
              macOS: <Typography.Text code>Command + Option + I</Typography.Text>
            </div>
          </div>
        </div>

        <div>
          <Typography.Link
            href="https://github.com/bosens-China"
            target="_blank"
            className="flex items-center gap-1.5 text-xs"
          >
            <GithubOutlined /> 开源地址 / GitHub: bosens-China
          </Typography.Link>
        </div>
      </Space>
    </Card>
  )
}
