import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { useCallback, useEffect, useState } from 'react'
import AppShell from './components/AppShell'
import LibraryPage from './components/LibraryPage'
import OverviewPage from './components/OverviewPage'
import SearchPage from './components/SearchPage'
import SourcesPage from './components/SourcesPage'
import type {
  CreateSourceInput,
  CrawlProgress,
  DocumentItem,
  DocumentSource,
  UpdateSourceInput,
  ViewKey
} from './types'

dayjs.locale('zh-cn')

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ViewKey>('overview')
  const [sources, setSources] = useState<DocumentSource[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentsError, setDocumentsError] = useState<string | null>(null)
  const [librarySourceId, setLibrarySourceId] = useState('all')
  const [libraryDocumentId, setLibraryDocumentId] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const loadSources = useCallback(async () => {
    try {
      setSources(await window.api.listSources())
      setSourcesError(null)
    } catch {
      setSourcesError('本地文档源加载失败，请重试')
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  const loadDocuments = useCallback(async () => {
    try {
      setDocuments(await window.api.listDocuments())
      setDocumentsError(null)
    } catch {
      setDocumentsError('本地文档加载失败，请重试')
    } finally {
      setDocumentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadSources)
  }, [loadSources])

  useEffect(() => {
    void Promise.resolve().then(loadDocuments)
  }, [loadDocuments])

  const reloadSources = (): void => {
    setSourcesLoading(true)
    void loadSources()
  }

  const reloadDocuments = (): void => {
    setDocumentsLoading(true)
    void loadDocuments()
  }

  const reloadLibrary = (): void => {
    reloadSources()
    reloadDocuments()
  }

  const handleCreateSource = async (input: CreateSourceInput): Promise<void> => {
    const source = await window.api.createSource(input)
    setSources((current) => [...current, source])
  }

  const handleDeleteSource = async (id: string): Promise<void> => {
    await window.api.deleteSource(id)
    setSources((current) => current.filter((source) => source.id !== id))
    setDocuments((current) => current.filter((document) => document.sourceId !== id))
    setLibrarySourceId((current) => (current === id ? 'all' : current))
    setLibraryDocumentId('')
  }

  const handleUpdateSource = async (id: string, input: UpdateSourceInput): Promise<void> => {
    const source = await window.api.updateSource(id, input)
    setSources((current) => current.map((item) => (item.id === id ? source : item)))
  }

  const openLibrary = (sourceId: string): void => {
    setLibrarySourceId(sourceId)
    setLibraryDocumentId('')
    setActiveView('library')
  }

  const openDocument = (document: DocumentItem): void => {
    setLibrarySourceId(document.sourceId)
    setLibraryDocumentId(document.id)
    setActiveView('library')
  }

  const changeLibrarySource = (sourceId: string): void => {
    setLibrarySourceId(sourceId)
    setLibraryDocumentId('')
  }

  const openSearch = (query: string): void => {
    setSearchQuery(query)
    setActiveView('search')
  }

  const searchDocuments = useCallback(
    (query: string): Promise<DocumentItem[]> => window.api.searchDocuments(query),
    []
  )

  const handleCrawlSource = async (id: string): Promise<CrawlProgress> => {
    try {
      return await window.api.crawlSource(id)
    } finally {
      await Promise.allSettled([loadSources(), loadDocuments()])
    }
  }

  return (
    <ConfigProvider locale={zhCN}>
      <AppShell activeView={activeView} onViewChange={setActiveView} onSearch={openSearch}>
        {activeView === 'overview' && (
          <OverviewPage
            sources={sources}
            documents={documents}
            loading={sourcesLoading || documentsLoading}
            error={sourcesError ?? documentsError}
            onRetry={reloadLibrary}
            onViewChange={setActiveView}
          />
        )}
        {activeView === 'sources' && (
          <SourcesPage
            sources={sources}
            loading={sourcesLoading}
            error={sourcesError}
            onRetry={reloadSources}
            onCreateSource={handleCreateSource}
            onUpdateSource={handleUpdateSource}
            onCrawlSource={handleCrawlSource}
            onOpenLibrary={openLibrary}
            onDeleteSource={handleDeleteSource}
          />
        )}
        {activeView === 'library' && (
          <LibraryPage
            sources={sources}
            documents={documents}
            loading={documentsLoading}
            error={documentsError}
            sourceId={librarySourceId}
            selectedDocumentId={libraryDocumentId}
            onSourceChange={changeLibrarySource}
            onDocumentSelect={setLibraryDocumentId}
            onRetry={reloadDocuments}
          />
        )}
        {activeView === 'search' && (
          <SearchPage
            initialQuery={searchQuery}
            onSearch={searchDocuments}
            onOpenDocument={openDocument}
          />
        )}
      </AppShell>
    </ConfigProvider>
  )
}

export default App
