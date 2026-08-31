import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Popconfirm, Typography } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { exportBackup, importBackup, readBackupFile } from '@/api/data-transfer'

/** 备份与恢复面板：提供全量数据 ZIP 导出与导入能力。 */
export function DataTransferPanel({
  className = ''
}: { className?: string } = {}): React.JSX.Element {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const exporting = useMutation({
    mutationFn: exportBackup,
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename)
      void message.success('备份已下载')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const importing = useMutation({
    mutationFn: async (file: File) => importBackup(await readBackupFile(file)),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      if (result.backgroundError) {
        void message.warning(
          `已恢复 ${result.sources} 个来源和 ${result.documents} 篇文档，但常驻 worker 启动失败：${result.backgroundError}`
        )
        return
      }
      void message.success(`已恢复 ${result.sources} 个来源和 ${result.documents} 篇文档`)
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const chooseFile = (): void => input.current?.click()
  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) importing.mutate(file)
  }

  return (
    <Card title="备份与恢复" className={className}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card type="inner" title="下载完整备份">
          <Typography.Paragraph type="secondary" className="text-sm leading-6">
            ZIP 内含 index.json 校验清单及按数据域拆分的 JSON，只保存到你选择的浏览器下载位置。
          </Typography.Paragraph>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting.isPending}
            onClick={() => exporting.mutate()}
          >
            导出 ZIP
          </Button>
        </Card>
        <Card type="inner" title="从备份恢复">
          <Typography.Paragraph type="secondary" className="text-sm leading-6">
            恢复会替换当前本地库。正在同步时会拒绝操作；需要持久后台能力时会立即确保无 HTTP 的常驻
            worker 可用。
          </Typography.Paragraph>
          <Popconfirm
            title="替换当前本地库？"
            description="建议先下载一份当前备份。此操作无法在界面中撤销。"
            okText="选择备份"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={chooseFile}
          >
            <Button danger icon={<UploadOutlined />} loading={importing.isPending}>
              导入 ZIP
            </Button>
          </Popconfirm>
          <input
            ref={input}
            type="file"
            accept="application/zip,.zip"
            onChange={onFile}
            style={{ display: 'none' }}
          />
        </Card>
      </div>
    </Card>
  )
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
