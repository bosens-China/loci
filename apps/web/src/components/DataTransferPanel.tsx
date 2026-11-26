import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Checkbox, Radio, Select, Space, Typography } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { listCategories } from '@/api/categories'
import { exportBackup, importBackup, readBackupFile } from '@/api/data-transfer'

/** 设置页共用运行时的分类筛选、合并及全量恢复契约。 */
export function DataTransferPanel({
  className = ''
}: { className?: string } = {}): React.JSX.Element {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [filtered, setFiltered] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [replaceAll, setReplaceAll] = useState(false)
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    enabled: filtered
  })

  const exporting = useMutation({
    mutationFn: exportBackup,
    onSuccess: ({ blob, filename }) => {
      downloadBlob(blob, filename)
      void message.success('备份已下载')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const importing = useMutation({
    mutationFn: async ({ file, replace }: { file: File; replace: boolean }) =>
      importBackup(await readBackupFile(file), replace),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error: Error) => void message.error(error.message)
  })

  const chooseFile = (): void => input.current?.click()
  const onFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    modal.confirm({
      title: replaceAll ? '清空全部文档库并恢复？' : '合并导入并覆盖匹配库？',
      content: file.name,
      okText: '确认导入',
      cancelText: '取消',
      okButtonProps: { danger: true },
      focusable: { autoFocusButton: 'cancel' },
      onOk: () => importing.mutateAsync({ file, replace: replaceAll })
    })
  }

  return (
    <Card title="备份与恢复" className={className}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card type="inner" title="导出备份">
          <Space orientation="vertical" className="w-full">
            <Radio.Group
              value={filtered}
              onChange={(event) => setFiltered(event.target.value === true)}
              options={[
                { label: '全部导出', value: false },
                { label: '按分类导出', value: true }
              ]}
            />
            {filtered && (
              <Select
                mode="multiple"
                className="w-full"
                placeholder="选择分类"
                value={selected}
                onChange={setSelected}
                loading={categories.isFetching}
                options={categories.data?.map(({ name }) => ({ label: name, value: name }))}
              />
            )}
            {filtered && categories.error && (
              <Alert type="error" message={categories.error.message} />
            )}
            <Button
              icon={<DownloadOutlined />}
              loading={exporting.isPending}
              disabled={filtered && !selected.length}
              onClick={() => exporting.mutate(filtered ? selected : undefined)}
            >
              导出 ZIP 备份
            </Button>
          </Space>
        </Card>
        <Card type="inner" title="导入备份">
          <Checkbox checked={replaceAll} onChange={(event) => setReplaceAll(event.target.checked)}>
            清空并全量替换
          </Checkbox>
          <Typography.Paragraph type="secondary" className="text-sm leading-6">
            {replaceAll
              ? '清空全部本地文档库，再恢复备份中的库。完整备份还会恢复设置和域名策略。'
              : '合并导入会先删除 ID 相同或来源与版本均相同的旧库，再恢复备份内容，保留其他库。'}
          </Typography.Paragraph>
          <Button
            danger
            icon={<UploadOutlined />}
            loading={importing.isPending}
            onClick={chooseFile}
          >
            导入 ZIP 恢复
          </Button>
          {importing.data && (
            <Alert
              type="success"
              message={`已新增 ${importing.data.importedLibraries - importing.data.replacedLibraries} 个库，覆盖 ${importing.data.replacedLibraries} 个库，导入 ${importing.data.importedDocuments} 篇文档。`}
            />
          )}
          <input
            ref={input}
            type="file"
            accept="application/zip,.zip"
            onChange={onFile}
            className="hidden"
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
