import { Alert, Button, Skeleton } from 'antd'
import { useAppSettings } from '../settings-context'
import type { DocumentItem, DocumentSource } from '../types'
import { OverviewEmptyState } from './overview/OverviewEmptyState'
import { OverviewHero } from './overview/OverviewHero'
import { OverviewRecentDocs } from './overview/OverviewRecentDocs'
import { OverviewSourceGrid } from './overview/OverviewSourceGrid'
import { OverviewStats } from './overview/OverviewStats'

export interface OverviewPageProps {
  sources: DocumentSource[]
  documents: DocumentItem[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenSources: () => void
  onSelectSource?: (sourceId: string) => void
  onOpenLibrary?: (documentId?: string, sourceId?: string) => void
  onCrawlSource?: (sourceId: string) => void
}

/**
 * 首页总览整合面板组件
 */
export function OverviewPage({
  sources,
  documents,
  loading,
  error,
  onRetry,
  onOpenSources,
  onSelectSource = () => {},
  onOpenLibrary = () => {},
  onCrawlSource
}: OverviewPageProps): React.JSX.Element {
  const { state: settingsState } = useAppSettings()

  if (loading && sources.length === 0 && documents.length === 0) {
    return (
      <div className="p-6 max-w-[1440px] mx-auto w-full">
        <Skeleton active paragraph={{ rows: 10 }} />
      </div>
    )
  }

  if (!loading && !error && sources.length === 0) {
    return <OverviewEmptyState onAddSource={onOpenSources} />
  }

  return (
    <div className="mx-auto h-full w-full max-w-[1440px] overflow-x-hidden overflow-y-auto pr-1">
      <OverviewHero onAddSource={onOpenSources} onSearchClick={() => onOpenLibrary()} />

      {error && (
        <Alert
          className="mb-6 rounded-xl"
          type="error"
          message={error}
          showIcon
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}

      <OverviewStats
        sources={sources}
        documents={documents}
        mcpStatus={settingsState.mcp}
        mcpPort={settingsState.settings.mcpPort}
      />

      <OverviewSourceGrid
        sources={sources.filter((source) => !source.cloud)}
        onOpenSources={onOpenSources}
        onSelectSource={onSelectSource}
        onCrawlSource={onCrawlSource}
      />

      <OverviewRecentDocs documents={documents} onOpenLibrary={onOpenLibrary} />
    </div>
  )
}

export default OverviewPage
