import { LinkOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Segmented,
  Select,
  Tabs,
  Typography
} from 'antd'
import { useEffect, useState } from 'react'
import CrawlProgressModal from './CrawlProgressModal'
import ScheduledSources from './ScheduledSources'
import SourceCard from './SourceCard'
import SourceScheduleFields from './SourceScheduleFields'
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
      <Modal
        title={editingSource ? '编辑文档源' : '添加文档源'}
        open={modalOpen}
        width={580}
        confirmLoading={submitting}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText={editingSource ? '保存修改' : '添加文档源'}
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} className="mt-4!">
          <Tabs
            defaultActiveKey="basic"
            items={[
              {
                key: 'basic',
                label: '基础配置',
                children: (
                  <div className="space-y-3 pt-2">
                    <Form.Item
                      name="name"
                      label="文档源名称"
                      rules={[{ required: true, message: '请输入文档源名称' }]}
                    >
                      <Input placeholder="例如：Electron Vite 官方文档" />
                    </Form.Item>
                    <Form.Item
                      name="url"
                      label="起始页面 URL"
                      extra="请输入文档站点的首页或任意起始阅读页面 URL"
                      rules={[
                        { required: true, message: '请输入公开文档页面 URL' },
                        { type: 'url', message: '请输入有效 URL 地址' }
                      ]}
                    >
                      <Input
                        prefix={<LinkOutlined />}
                        placeholder="https://example.com/docs/start"
                      />
                    </Form.Item>
                    <Form.Item
                      name="pageLimit"
                      label="收录页面上限"
                      extra="达到设定的页面上限后将自动停止，防止无限制抓取"
                      rules={[{ required: true, message: '请输入页面上限' }]}
                    >
                      <InputNumber min={1} max={10000} className="w-full" addonAfter="页" />
                    </Form.Item>
                  </div>
                )
              },
              {
                key: 'schedule',
                label: '自动更新',
                children: <SourceScheduleFields form={form} />
              },
              {
                key: 'advanced',
                label: '高级设置',
                children: (
                  <div className="space-y-3 pt-2">
                    <Form.Item name="mode" label="网页读取方式" rules={[{ required: true }]}>
                      <Select
                        options={[
                          { value: 'auto', label: '自动检测（推荐 · 识别最佳速度）' },
                          { value: 'http', label: 'HTTP 直取（适用于普通静态网页）' },
                          { value: 'browser', label: '浏览器渲染（适用于动态渲染网页）' }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name="concurrency"
                      label="并发抓取数"
                      extra="留空时默认使用“设置”页面中的全局并发配置（常规保持默认即可）"
                      rules={[{ type: 'number', min: 1, max: 32, message: '请输入 1-32' }]}
                    >
                      <InputNumber
                        min={1}
                        max={32}
                        className="w-full"
                        placeholder="使用全局默认值"
                      />
                    </Form.Item>
                  </div>
                )
              }
            ]}
          />
        </Form>
      </Modal>
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
