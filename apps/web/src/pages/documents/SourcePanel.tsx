import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { DocumentSource } from '@loci/shared'
import { listSources } from '@/api/sources'
import { StatusPill } from '@/components/StatusPill'
import { LibraryOriginTag } from '@/components/library/LibraryOriginTag'
import { FETCH_MODE_LABELS } from '@/utils/status-labels'
import { SourceActions, SourceFormModal } from '@/pages/documents/SourceFormModal'

const DISCOVERY_LABELS = {
  github: 'GitHub',
  llms: 'llms.txt',
  openapi: 'OpenAPI',
  pages: '网页'
} as const

interface SourcePanelProps {
  selectedId: string
  onSelect: (sourceId: string) => void
}

/** 左侧来源列表：本地来源与云端副本分组展示。 */
export function SourcePanel(props: SourcePanelProps): React.JSX.Element {
  const [editing, setEditing] = useState<DocumentSource | 'new' | null>(null)
  const query = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const local = query.data?.filter((source) => !source.cloud) ?? []
  const cloud = query.data?.filter((source) => source.cloud) ?? []

  return (
    <>
      <div className="workspace-pane h-full border-r">
        <div className="pane-header">
          <span className="pane-title">文档来源</span>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setEditing('new')}
          >
            添加
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {query.isLoading && <PanelHint>正在加载来源…</PanelHint>}
          {query.data?.length === 0 && !query.isLoading && (
            <PanelHint>添加第一个来源，开始收录文档</PanelHint>
          )}
          {local.length > 0 && (
            <SourceGroup
              label="本地来源"
              sources={local}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
              onEdit={setEditing}
            />
          )}
          {cloud.length > 0 && (
            <SourceGroup
              label="云端副本"
              sources={cloud}
              selectedId={props.selectedId}
              onSelect={props.onSelect}
              onEdit={setEditing}
            />
          )}
        </div>
      </div>
      <SourceFormModal
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => undefined}
      />
    </>
  )
}

function SourceGroup(props: {
  label: string
  sources: DocumentSource[]
  selectedId: string
  onSelect: (id: string) => void
  onEdit: (source: DocumentSource) => void
}): React.JSX.Element {
  return (
    <section className="mb-4">
      <div className="mb-1 px-2 text-[11px] font-650 tracking-wide text-muted uppercase">
        {props.label}
      </div>
      {props.sources.map((source) => {
        const selected = props.selectedId === source.id
        return (
          <div
            key={source.id}
            className={`relative mb-1 w-full rounded-lg border text-left transition-colors ${
              selected ? 'border-accent/30 bg-[#eaf4f3]' : 'border-transparent hover:bg-[#f3f7f6]'
            }`}
          >
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => props.onSelect(source.id)}
              className="focus-ring block w-full rounded-lg px-3 py-2.5 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-650">{source.name}</span>
                <span className="shrink-0">
                  <StatusPill status={source.status} />
                </span>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-muted">{source.url}</div>
              <div className="mt-1.5 flex min-h-6 items-center justify-between text-[11px] text-muted">
                <span>
                  {source.pages} 页{!source.cloud && ` · ${sourceRouteLabel(source)}`}
                </span>
                <span className={selected ? 'invisible' : ''}>
                  {source.cloud ? (
                    <LibraryOriginTag origin="cloud" autoSync={source.cloud.autoSync} />
                  ) : (
                    source.schedule
                  )}
                </span>
              </div>
            </button>
            <div
              className={`absolute right-3 bottom-2.5 ${
                selected ? '' : 'pointer-events-none invisible'
              }`}
              aria-hidden={!selected}
              inert={selected ? undefined : true}
            >
              <SourceActions compact source={source} onEdit={() => props.onEdit(source)} />
            </div>
          </div>
        )
      })}
    </section>
  )
}

function sourceRouteLabel(source: DocumentSource): string {
  if (source.kind === 'github') return 'GitHub'
  const discovery = source.resolvedDiscovery
    ? DISCOVERY_LABELS[source.resolvedDiscovery]
    : '普通站点'
  return `${discovery} · ${FETCH_MODE_LABELS[source.mode]}`
}

function PanelHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 py-6 text-center text-xs leading-5 text-muted">{children}</p>
}
