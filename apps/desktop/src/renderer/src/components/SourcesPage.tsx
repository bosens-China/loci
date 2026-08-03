import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Empty, Form, Input, message, Segmented, Tabs, Typography } from 'antd'
import { useEffect, useState } from 'react'
import CrawlProgressModal from './CrawlProgressModal'
import ScheduledSources from './ScheduledSources'
import SourceCard from './SourceCard'
import { SourceFormModal } from './SourceFormModal'
import { indexCrawlRuns, mergeCrawlNode } from './crawlRunState'
import {
  getSourceFormValues,
  toCreateSourceInput,
  type SourceFormValues
} from './sourceScheduleForm'
import type {
  CreateSourceInput,
  CrawlProgress,
  CrawlProgressEvent,
  CrawlRunState,
  DocumentSource,
  UpdateSourceInput
} from '../types'

interface SourcesPageProps {
  sources: DocumentSource[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onCreateSource: (input: CreateSourceInput) => Promise<void>
  onUpdateSource: (id: string, input: UpdateSourceInput) => Promise<void>
  onCrawlSource: (id: string) => Promise<CrawlProgress>
  onOpenLibrary: (sourceId: string) => void
  onDeleteSource: (id: string) => Promise<void>
  activeTab: SourcesTab
  onTabChange: (tab: SourcesTab) => void
}

export type SourcesTab = 'sources' | 'schedules'
type StatusFilter = 'all' | 'healthy' | 'syncing' | 'attention'

function SourcesPage({
  sources,
  loading,
  error,
  onRetry,
  onCreateSource,
  onUpdateSource,
  onCrawlSource,
  onOpenLibrary,
  onDeleteSource,
  activeTab,
  onTabChange
}: SourcesPageProps): React.JSX.Element {
  const [form] = Form.useForm<SourceFormValues>()
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingSource, setEditingSource] = useState<DocumentSource | null>(null)
  const [crawlRuns, setCrawlRuns] = useState<Record<string, CrawlRunState>>({})
  const [openCrawlId, setOpenCrawlId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [messageApi, contextHolder] = message.useMessage()
  const scheduledSources = sources.filter((source) => source.schedule)

  useEffect(() => {
    let active = true
    const unsubscribe = window.api.onCrawlProgress((event: CrawlProgressEvent) => {
      setCrawlRuns((current) => {
        const previous = current[event.sourceId]
        return {
          ...current,
          [event.sourceId]: {
            sourceId: event.sourceId,
            progress: event.progress,
            nodes: mergeCrawlNode(previous?.nodes ?? [], event.progress.node),
            error: event.error,
            running: event.running
          }
        }
      })
    })
    void window.api
      .listCrawlRuns()
      .then((runs) => {
        if (active) setCrawlRuns((current) => ({ ...indexCrawlRuns(runs), ...current }))
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const openCreateModal = (): void => {
    form.setFieldsValue(getSourceFormValues())
    setEditingSource(null)
    setModalOpen(true)
  }

  const openEditModal = (source: DocumentSource): void => {
    setEditingSource(source)
    form.setFieldsValue(getSourceFormValues(source))
    setModalOpen(true)
  }

  const handleCreate = (values: SourceFormValues): void => {
    let input: CreateSourceInput
    try {
      input = toCreateSourceInput({
        ...values,
        scheduleEnabled: form.getFieldValue('scheduleEnabled') === true,
        scheduleExpression: form.getFieldValue('scheduleExpression')
      })
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '定时抓取配置无效')
      return
    }
    setSubmitting(true)
    const save = editingSource ? onUpdateSource(editingSource.id, input) : onCreateSource(input)
    void save
      .then(() => {
        setModalOpen(false)
        messageApi.success(editingSource ? '文档源已更新' : '文档源已添加到本地数据库')
      })
      .catch((error: unknown) => {
        messageApi.error(error instanceof Error ? error.message : '文档源添加失败')
      })
      .finally(() => setSubmitting(false))
  }

  const handleCrawl = (source: DocumentSource): void => {
    const existingRun = crawlRuns[source.id]
    if (existingRun?.running) {
      setOpenCrawlId(source.id)
      return
    }
    const initialNode = {
      id: source.url,
      url: source.url,
      title: source.mode === 'auto' ? '正在检测抓取方式' : '正在读取第一个页面',
      status: 'running' as const
    }
    const initialRun: CrawlRunState = {
      sourceId: source.id,
      progress: {
        queued: 1,
        processed: 0,
        succeeded: 0,
        failed: 0,
        limitReached: false,
        node: initialNode
      },
      nodes: [initialNode],
      error: null,
      running: true
    }
    setCrawlRuns((current) => ({ ...current, [source.id]: initialRun }))
    setOpenCrawlId(source.id)
    void onCrawlSource(source.id)
      .then((progress) => {
        const content = `更新完成：成功 ${progress.succeeded} 页，失败 ${progress.failed} 页`
        if (progress.failed > 0) messageApi.warning(content)
        else messageApi.success(content)
      })
      .catch((error: unknown) => {
        messageApi.error(error instanceof Error ? error.message : '更新失败')
      })
  }

  const filteredSources = sources.filter((source) => {
    const run = crawlRuns[source.id]
    const effectiveStatus = run?.running
      ? 'syncing'
      : run?.error || run?.progress.failed
        ? 'attention'
        : source.status

    if (statusFilter !== 'all' && effectiveStatus !== statusFilter) return false

    const query = searchQuery.trim().toLowerCase()
    if (!query) return true
    return source.name.toLowerCase().includes(query) || source.url.toLowerCase().includes(query)
  })

  return (
    <div className="mx-auto h-full w-full max-w-[1440px] overflow-x-hidden overflow-y-auto pr-1">
      {contextHolder}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Typography.Title level={2}>文档源</Typography.Title>
          <Typography.Paragraph type="secondary">
            管理公开文档站点，控制抓取方式和更新节奏。
          </Typography.Paragraph>
        </div>
        {activeTab === 'sources' && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
            添加文档源
          </Button>
        )}
      </div>
      {error && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <Tabs
          activeKey={activeTab}
          className="mb-0!"
          items={[
            { key: 'sources', label: `文档源（${sources.length}）` },
            { key: 'schedules', label: `定时更新（${scheduledSources.length}）` }
          ]}
          onChange={(key) => {
            if (key === 'sources' || key === 'schedules') onTabChange(key)
          }}
        />
        {activeTab === 'sources' && sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              size="middle"
              value={statusFilter}
              options={[
                { label: '全部', value: 'all' },
                { label: '正常', value: 'healthy' },
                { label: '更新中', value: 'syncing' },
                { label: '需检查', value: 'attention' }
              ]}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
            />
            <Input
              allowClear
              size="middle"
              prefix={<SearchOutlined className="text-gray-400" />}
              placeholder="按名称或 URL 检索..."
              value={searchQuery}
              className="w-64"
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[0, 1].map((item) => (
            <Card key={item} loading />
          ))}
        </div>
      ) : activeTab === 'schedules' ? (
        <ScheduledSources
          sources={scheduledSources}
          onEdit={openEditModal}
          onShowSources={() => onTabChange('sources')}
        />
      ) : sources.length === 0 ? (
        <Card>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有文档源">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
              立即添加第一个文档源
            </Button>
          </Empty>
        </Card>
      ) : filteredSources.length === 0 ? (
        <Card>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配检索条件的文档源" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filteredSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              crawlRun={crawlRuns[source.id]}
              onOpenLibrary={onOpenLibrary}
              onCrawl={handleCrawl}
              onOpenCrawlProgress={(sourceId) => setOpenCrawlId(sourceId)}
              onEdit={openEditModal}
              onDelete={onDeleteSource}
            />
          ))}
        </div>
      )}
      <SourceFormModal
        form={form}
        editingSource={editingSource}
        open={modalOpen}
        submitting={submitting}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
      {openCrawlId && crawlRuns[openCrawlId] && (
        <CrawlProgressModal
          open
          sourceName={sources.find((source) => source.id === openCrawlId)?.name ?? '文档源'}
          progress={crawlRuns[openCrawlId].progress}
          nodes={crawlRuns[openCrawlId].nodes}
          error={crawlRuns[openCrawlId].error}
          running={crawlRuns[openCrawlId].running}
          onClose={() => setOpenCrawlId(null)}
        />
      )}
    </div>
  )
}

export default SourcesPage
