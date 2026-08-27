import { useMemo, useState } from 'react'
import type { CloudLibrary, DocumentSource } from '@loci/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { App, Button, Empty, Radio, Select } from 'antd'
import { CloudUploadOutlined } from '@ant-design/icons'
import { publishAdminLibrary } from '@/api/admin'
import { listSources } from '@/api/sources'
import { formatBytes } from '@/utils/format'

export function AdminPublishPanel({ libraries }: { libraries: CloudLibrary[] }): React.JSX.Element {
  const { message, modal } = App.useApp()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'create' | 'replace'>('create')
  const [target, setTarget] = useState<string>()
  const localSources = useMemo(
    () => (sources.data ?? []).filter((source) => !source.cloud && source.pages > 0),
    [sources.data]
  )
  const publish = useMutation({
    mutationFn: () =>
      publishAdminLibrary(selected!, {
        mode,
        ...(mode === 'replace' && target ? { targetLibraryId: target } : {})
      }),
    onSuccess: (result) => {
      void message.success(
        result.reused
          ? `已复用发布结果：${result.library.name}`
          : `已发布 ${result.pages} 篇文档：${result.library.name}`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const confirm = (): void => {
    const source = localSources.find((item) => item.id === selected)
    const targetLibrary = libraries.find((item) => item.id === target)
    if (!source || (mode === 'replace' && !targetLibrary)) return
    modal.confirm({
      title:
        mode === 'create'
          ? `把“${source.name}”发布为新的公开文档库？`
          : `用“${source.name}”覆盖“${targetLibrary?.name}”？`,
      content:
        mode === 'create'
          ? '将只上传该文档库的公开元数据与正文 ZIP，不包含设置、凭据和任务历史。'
          : '目标 Server 文档库的正文和公开快照会被事务性替换；失败时保留旧版本。',
      okText: mode === 'create' ? '确认发布' : '确认覆盖',
      okButtonProps: { danger: mode === 'replace' },
      cancelText: '返回',
      onOk: () => publish.mutateAsync()
    })
  }

  return (
    <section className="panel overflow-hidden">
      <div className="pane-header">
        <div>
          <span className="pane-title">发布本地文档库</span>
          <p className="mb-0 mt-1 text-xs text-muted">
            使用带校验的压缩二进制归档上传；创建与覆盖必须显式选择。
          </p>
        </div>
      </div>
      <div className="p-5">
        {localSources.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {localSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  selected={selected === source.id}
                  onSelect={() => setSelected(source.id)}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-xl bg-[#f5f8f7] p-4 md:flex-row md:items-center">
              <Radio.Group
                value={mode}
                onChange={(event) => setMode(event.target.value as 'create' | 'replace')}
                options={[
                  { label: '创建新库', value: 'create' },
                  { label: '覆盖现有库', value: 'replace' }
                ]}
              />
              {mode === 'replace' && (
                <Select
                  className="min-w-60 flex-1"
                  placeholder="选择要覆盖的 Server 文档库"
                  value={target}
                  onChange={setTarget}
                  options={libraries.map((library) => ({
                    value: library.id,
                    label: `${library.name} · ${library.hostname}`
                  }))}
                />
              )}
              <Button
                type="primary"
                danger={mode === 'replace'}
                icon={<CloudUploadOutlined />}
                disabled={!selected || (mode === 'replace' && !target)}
                loading={publish.isPending}
                onClick={confirm}
              >
                发布到 Server
              </Button>
            </div>
          </>
        ) : (
          <Empty description="暂无包含正文的本地文档库" />
        )}
      </div>
    </section>
  )
}

function SourceCard(props: {
  source: DocumentSource
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`rounded-xl border p-4 text-left transition ${
        props.selected
          ? 'border-accent bg-[#edf6f5]'
          : 'border-[#dce6e5] bg-white hover:border-accent'
      }`}
      onClick={props.onSelect}
    >
      <strong className="block truncate text-sm text-ink">{props.source.name}</strong>
      <span className="mt-2 block text-xs text-muted">
        {props.source.pages} 页 · {formatBytes(props.source.contentSize)}
      </span>
      <span className="mt-1 block truncate font-mono text-[11px] text-muted">
        {new URL(props.source.url).hostname}
      </span>
    </button>
  )
}
