import {
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileSearchOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Tabs,
  Tooltip,
  Typography
} from 'antd'
import { useEffect, useState } from 'react'
import CrawlProgressModal from './CrawlProgressModal'
import ScheduledSources from './ScheduledSources'
import SourceScheduleFields, { SourceScheduleTag } from './SourceScheduleFields'
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

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      {contextHolder}
      <div className="mb-6 flex items-end justify-between gap-4">
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
      <Tabs
        activeKey={activeTab}
        items={[
          { key: 'sources', label: '文档源' },
          { key: 'schedules', label: `定时更新（${scheduledSources.length}）` }
        ]}
        onChange={(key) => {
          if (key === 'sources' || key === 'schedules') onTabChange(key)
        }}
      />
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
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有文档源" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sources.map((source) => {
            const run = crawlRuns[source.id]
            const running = run?.running ?? false
            const status = running
              ? 'syncing'
              : run?.error || run?.progress.failed
                ? 'attention'
                : source.status
            return (
              <Card key={source.id} className="h-full" hoverable>
                <div className="flex items-start gap-4">
                  <Avatar
                    shape="square"
                    size={48}
                    src={source.iconUrl ?? undefined}
                    alt={`${source.name} 图标`}
                    icon={<LinkOutlined />}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <Typography.Link strong onClick={() => onOpenLibrary(source.id)}>
                        {source.name}
                      </Typography.Link>
                      <Tag
                        color={
                          status === 'healthy'
                            ? 'success'
                            : status === 'syncing'
                              ? 'processing'
                              : 'warning'
                        }
                      >
                        {status === 'healthy' ? '正常' : status === 'syncing' ? '更新中' : '需检查'}
                      </Tag>
                    </div>
                    <Typography.Text ellipsis type="secondary" className="mt-1 block text-xs">
                      {source.url}
                    </Typography.Text>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Tag>
                        {source.mode === 'auto'
                          ? '自动检测'
                          : source.mode === 'http'
                            ? 'HTTP 直取'
                            : '浏览器渲染'}
                      </Tag>
                      <Tag>{source.pages} 页</Tag>
                      <Tag>{source.concurrency ? `并发 ${source.concurrency}` : '默认并发'}</Tag>
                      <SourceScheduleTag schedule={source.schedule} />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-solid border-[var(--ant-color-border-secondary)] pt-3">
                      <Tag
                        icon={<ClockCircleOutlined />}
                        className="m-0! border-0! bg-[var(--ant-color-fill-tertiary)]! px-2.5! py-1! text-xs! text-[var(--ant-color-text-secondary)]!"
                      >
                        更新于 {source.lastUpdated}
                      </Tag>
                      <Space size="small">
                        <Tooltip title="在知识库中查看">
                          <Button
                            type="text"
                            size="small"
                            icon={<FileSearchOutlined />}
                            aria-label="在知识库中查看文档源"
                            onClick={() => onOpenLibrary(source.id)}
                          />
                        </Tooltip>
                        <Tooltip title={running ? '查看抓取进度' : '更新文档源'}>
                          <Button
                            type="text"
                            size="small"
                            icon={<ReloadOutlined spin={running} />}
                            aria-label={running ? '查看抓取进度' : '更新文档源'}
                            onClick={() => handleCrawl(source)}
                          />
                        </Tooltip>
                        <Tooltip title="编辑文档源">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            aria-label="编辑文档源"
                            disabled={running}
                            onClick={() => openEditModal(source)}
                          />
                        </Tooltip>
                        <Popconfirm
                          disabled={running}
                          title="删除这个文档源？"
                          description="已收录的页面也会从本地索引中移除。"
                          okText="删除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => onDeleteSource(source.id)}
                        >
                          <Button
                            danger
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            aria-label="删除文档源"
                            disabled={running}
                          />
                        </Popconfirm>
                      </Space>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <Modal
        title={editingSource ? '编辑文档源' : '添加文档源'}
        open={modalOpen}
        confirmLoading={submitting}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText={editingSource ? '保存' : '添加文档源'}
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} className="mt-5!">
          <Form.Item
            name="name"
            label="文档源名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：Electron Vite" />
          </Form.Item>
          <Form.Item
            name="url"
            label="第一个页面"
            rules={[
              { required: true, message: '请输入公开文档页面 URL' },
              { type: 'url', message: '请输入有效 URL' }
            ]}
          >
            <Input prefix={<LinkOutlined />} placeholder="https://example.com/docs/start" />
          </Form.Item>
          <Form.Item name="mode" label="抓取方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'auto', label: '自动检测' },
                { value: 'http', label: 'HTTP 直取' },
                { value: 'browser', label: '浏览器渲染' }
              ]}
            />
          </Form.Item>
          <Form.Item
            name="pageLimit"
            label="页面上限"
            rules={[{ required: true, message: '请输入页面上限' }]}
          >
            <InputNumber min={1} max={10000} className="w-full" addonAfter="页" />
          </Form.Item>
          <Form.Item
            name="concurrency"
            label="抓取并发"
            extra="留空时按实际抓取方式使用设置页中的全局默认值"
            rules={[{ type: 'number', min: 1, max: 32, message: '请输入 1 到 32 之间的整数' }]}
          >
            <InputNumber min={1} max={32} className="w-full" placeholder="使用全局默认值" />
          </Form.Item>
          <SourceScheduleFields form={form} />
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
