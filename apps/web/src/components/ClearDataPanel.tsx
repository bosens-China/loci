import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Space, Typography } from 'antd'
import type { ClearDataCounts, ClearDataScope } from '@loci/shared'
import { clearData, getClearDataCounts } from '@/api/data-transfer'

/** 清空前读取当前数量，确认后调用与 CLI 相同的维护操作。 */
export function ClearDataPanel(): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const clearing = useMutation({
    mutationFn: clearData,
    onSuccess: (summary) => {
      void client.invalidateQueries()
      void message.success(
        summary.scope === 'documents'
          ? `已清空 ${summary.documents} 篇文档`
          : `已删除 ${summary.libraries} 个文档库及 ${summary.documents} 篇文档`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const preview = useMutation<ClearDataCounts, Error, ClearDataScope>({
    mutationFn: getClearDataCounts,
    onSuccess: ({ libraries, documents }, scope) => {
      const documentsOnly = scope === 'documents'
      modal.confirm({
        title: documentsOnly ? '清空全部文档？' : '清空全部文档库？',
        content: documentsOnly
          ? `将删除 ${libraries} 个库中的 ${documents} 篇文档及索引，包括手工文档和旧只读快照的正文。文档库和设置会保留。`
          : `将删除 ${libraries} 个文档库、${documents} 篇文档及索引、抓取记录和指定页面。分类和全局设置会保留。`,
        okText: documentsOnly ? '清空文档' : '清空全部文档库',
        okButtonProps: { danger: true },
        cancelText: '取消',
        focusable: { autoFocusButton: 'cancel' },
        onOk: () => clearing.mutateAsync(scope)
      })
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const busy = preview.isPending || clearing.isPending
  return (
    <Card title="清空本地数据">
      <Typography.Paragraph type="secondary">
        可仅清空文档，也可删除所有文档库。手工内容和旧只读快照可先导出备份。
      </Typography.Paragraph>
      <Space wrap>
        <Button danger disabled={busy} onClick={() => preview.mutate('documents')}>
          清空文档
        </Button>
        <Button danger disabled={busy} onClick={() => preview.mutate('sources')}>
          清空全部文档库
        </Button>
      </Space>
    </Card>
  )
}
