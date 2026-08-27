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
    <section className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] mt-5 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-4 py-2.5">
        <span className="text-xs font-650 tracking-wide text-[var(--ant-color-text-secondary)] uppercase">
          备份与恢复
        </span>
      </div>
      <div className="grid grid-cols-1 gap-5 p-5 md:grid-cols-2">
        <TransferAction
          title="下载完整备份"
          description="ZIP 内含 index.json 校验清单及按数据域拆分的 JSON，只保存到你选择的浏览器下载位置。"
        >
          <Button
            icon={<DownloadOutlined />}
            loading={exporting.isPending}
            onClick={() => exporting.mutate()}
          >
            导出 ZIP
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
              导入 ZIP
            </Button>
          </Popconfirm>
          <input
            ref={input}
            className="hidden"
            type="file"
            accept="application/zip,.zip"
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
      className={`rounded-xl border-l-3 bg-[var(--ant-color-fill-quaternary)] p-4 ${props.danger ? 'border-[var(--ant-color-error)]' : 'border-[var(--ant-color-primary)]'}`}
    >
      <h3 className="m-0 text-sm font-700">{props.title}</h3>
      <p className="mb-4 mt-2 text-xs leading-5 text-[var(--ant-color-text-secondary)]">
        {props.description}
      </p>
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
