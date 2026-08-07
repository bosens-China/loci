import { CodeOutlined, DownloadOutlined, GithubOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Card, Space, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import type { DesktopUpdateState } from '@loci/shared'

/**
 * 关于 Loci 与快捷键说明卡片
 */
export function AboutSettingsCard(): React.JSX.Element {
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null)
  const [checking, setChecking] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    void window.api.getDesktopUpdate().then(setUpdate)
  }, [])

  useEffect(() => {
    if (update?.status !== 'checking' && update?.status !== 'downloading') return
    const timer = window.setInterval(() => void window.api.getDesktopUpdate().then(setUpdate), 1000)
    return () => window.clearInterval(timer)
  }, [update?.status])

  const checkUpdate = async (): Promise<void> => {
    setChecking(true)
    try {
      const next = await window.api.checkDesktopUpdate()
      setUpdate(next)
      messageApi.success(
        next.updateAvailable && next.autoUpdateSupported
          ? next.status === 'ready'
            ? '更新已下载，将在退出后自动安装'
            : '发现更新，已开始后台下载'
          : next.updateAvailable
            ? '发现可用更新'
            : 'Loci 已是最新版本'
      )
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '检查更新失败')
    } finally {
      setChecking(false)
    }
  }

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
      {contextHolder}
      <Space direction="vertical" size="middle" className="w-full">
        <Typography.Paragraph className="mb-0 text-sm">
          Loci 是一款面向 AI Agent 的本地文档索引与知识库系统。用户提供公开文档 URL
          后，应用自动解析并转换为 Markdown，保存在本机，并通过内建 MCP 协议与 AI 编程工具直接对话。
        </Typography.Paragraph>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4">
          <div>
            <Space size="small">
              <Typography.Text strong>应用版本</Typography.Text>
              <Tag color={update?.updateAvailable ? 'processing' : 'success'}>
                当前 v{update?.currentVersion ?? '—'}
              </Tag>
            </Space>
            {update?.status === 'error' ? (
              <Typography.Paragraph className="mb-0! mt-2! text-xs" type="danger">
                自动更新失败：{update.error ?? '未知错误'}
              </Typography.Paragraph>
            ) : update?.updateAvailable ? (
              <Typography.Paragraph className="mb-0! mt-2! text-xs" type="warning">
                {update.autoUpdateSupported
                  ? update.status === 'ready'
                    ? `v${update.latestVersion} 已下载，将在退出应用后自动安装。`
                    : update.status === 'downloading'
                      ? `正在后台下载 v${update.latestVersion}${update.downloadProgress === null ? '' : `（${update.downloadProgress}%）`}。`
                      : `已发布 v${update.latestVersion}，将在后台自动下载。`
                  : `已发布 v${update.latestVersion}，请下载新版本手动安装。`}
              </Typography.Paragraph>
            ) : (
              <Typography.Paragraph className="mb-0! mt-2! text-xs" type="secondary">
                {update?.checkedAt ? '已检查更新。' : '启动后会在后台检查更新。'}
              </Typography.Paragraph>
            )}
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} loading={checking} onClick={() => void checkUpdate()}>
              检查更新
            </Button>
            {update?.updateAvailable &&
              (!update.autoUpdateSupported || update.status === 'error') && (
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  onClick={() => void window.api.openDesktopRelease()}
                >
                  前往下载
                </Button>
              )}
          </Space>
          {update?.updateAvailable && update.manualInstallHint && (
            <Typography.Text type="secondary" className="w-full text-xs">
              {update.manualInstallHint}
            </Typography.Text>
          )}
        </div>

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
