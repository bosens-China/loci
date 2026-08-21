import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Popconfirm } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { exportBackup, importBackup, readBackupFile } from '@/api/data-transfer'

export function DataTransferPanel(): React.JSX.Element {
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
    <section className="panel mt-5 overflow-hidden">
      <div className="pane-header">
        <span className="pane-title">备份与恢复</span>
      </div>
      <div className="grid grid-cols-2 gap-5 p-5">
        <TransferAction
          title="下载完整备份"
          description="包含来源、文档、抓取记录和运行设置，文件只保存到你选择的浏览器下载位置。"
        >
          <Button
            icon={<DownloadOutlined />}
            loading={exporting.isPending}
            onClick={() => exporting.mutate()}
          >
            导出 JSON
          </Button>
        </TransferAction>
        <TransferAction
          title="从备份恢复"
          description="恢复会替换当前本地库。正在同步时会拒绝操作；需要持久后台能力时会立即确保无 HTTP 的常驻 worker 可用。"
          danger
        >
          <Popconfirm
            title="替换当前本地库？"
            description="建议先下载一份当前备份。此操作无法在界面中撤销。"
            okText="选择备份"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={chooseFile}
          >
            <Button danger icon={<UploadOutlined />} loading={importing.isPending}>
              导入 JSON
            </Button>
          </Popconfirm>
          <input
            ref={input}
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={onFile}
          />
        </TransferAction>
      </div>
    </section>
  )
}

function TransferAction(props: {
  title: string
  description: string
  danger?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`rounded-xl border-l-3 bg-[#f8faf9] p-4 ${props.danger ? 'border-[#b6423c]' : 'border-accent'}`}
    >
      <h3 className="m-0 text-sm font-700">{props.title}</h3>
      <p className="mb-4 mt-2 text-xs leading-5 text-muted">{props.description}</p>
      {props.children}
    </div>
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
