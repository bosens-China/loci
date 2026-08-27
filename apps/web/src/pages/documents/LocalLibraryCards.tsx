import { useState } from 'react'
import type { DocumentSource } from '@loci/shared'
import { BookOutlined, CloudOutlined, GithubOutlined } from '@ant-design/icons'
import { Button, Drawer, Empty, Tag } from 'antd'
import { PageHeader } from '@/components/PageHeader'
import { formatBytes } from '@/utils/format'
import { SourcePanel } from '@/pages/documents/SourcePanel'

export function LocalLibraryCards(props: {
  sources: DocumentSource[]
  onSelect: (id: string) => void
}): React.JSX.Element {
  const [managerOpen, setManagerOpen] = useState(false)
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="本地文档库"
        description="先选择文档库，再按需展开目录和读取正文。"
        action={<Button onClick={() => setManagerOpen(true)}>管理文档源</Button>}
      />
      {props.sources.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {props.sources.map((source) => (
            <button
              key={source.id}
              type="button"
              className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ant-color-primary)] min-w-0 p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
              onClick={() => props.onSelect(source.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--ant-color-fill-quaternary)] text-[var(--ant-color-primary)]">
                  {source.kind === 'github' ? (
                    <GithubOutlined />
                  ) : source.cloud ? (
                    <CloudOutlined />
                  ) : (
                    <BookOutlined />
                  )}
                </span>
                <Tag color={source.status === 'attention' ? 'warning' : 'success'}>
                  {source.status === 'attention' ? '需检查' : '可用'}
                </Tag>
              </div>
              <h2 className="mt-4 truncate text-lg font-600 text-[var(--ant-color-text)]">
                {source.name}
              </h2>
              <div className="truncate font-mono text-[11px] text-[var(--ant-color-text-secondary)]">
                {new URL(source.url).hostname}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--ant-color-text-secondary)]">
                <span>{source.pages} 页</span>
                <span>·</span>
                <span>{formatBytes(source.contentSize)}</span>
                <span>·</span>
                <span>{source.lastUpdated}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] py-16">
          <Empty description="还没有本地文档库" />
        </div>
      )}
      <Drawer
        title="管理文档源"
        placement="left"
        width={380}
        open={managerOpen}
        styles={{ body: { padding: 0 } }}
        onClose={() => setManagerOpen(false)}
      >
        <SourcePanel
          selectedId=""
          onSelect={(id) => {
            setManagerOpen(false)
            props.onSelect(id)
          }}
        />
      </Drawer>
    </div>
  )
}
