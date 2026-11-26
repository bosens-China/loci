import {
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  GithubOutlined,
  GlobalOutlined,
  RightOutlined,
  StopOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Avatar,
  Button,
  Card,
  Checkbox,
  Popconfirm,
  Popover,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { LibraryCrawlStatus, LibrarySummary } from '@loci/shared'
import { cancelLibraryCrawl, deleteLibrary, syncLibrary } from '@/api/libraries'
import { formatDateTime } from '@/utils/format'

export interface LocalLibraryCardItemProps {
  library: LibrarySummary
  crawlStatus?: LibraryCrawlStatus | null
  isSelected: boolean
  selectMode: boolean
  onSelectCard: () => void
  onToggleSelect: () => void
  onEdit: () => void
}

/** 单张本地文档库卡片：展示收录页数、语言、抓取进度条、取消操作及状态诊断。 */
export function LocalLibraryCardItem(props: LocalLibraryCardItemProps): React.JSX.Element {
  const { library, crawlStatus, isSelected, selectMode } = props
  const { message } = App.useApp()
  const client = useQueryClient()

  // 触发单库全量更新
  const syncMutation = useMutation({
    mutationFn: () => syncLibrary(library.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['libraries'] })
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      void message.success('已启动抓取更新')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  // 取消正在进行的抓取
  const cancelMutation = useMutation({
    mutationFn: () => cancelLibraryCrawl(library.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      void message.info('已请求取消抓取')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  // 删除单库
  const deleteMutation = useMutation({
    mutationFn: () => deleteLibrary(library.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['libraries'] })
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      void message.success('文档库已删除')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const isGithub = library.kind === 'github'
  const isRunning = crawlStatus?.status === 'running'
  const progress = crawlStatus?.progress
  const discovered = progress?.discovered ?? 0
  const processed = progress?.processed ?? 0
  const percent = discovered > 0 ? Math.min(100, Math.round((processed / discovered) * 100)) : 0

  return (
    <Card
      hoverable
      className={`group relative flex flex-col justify-between overflow-hidden cursor-pointer transition-all duration-200 ${
        isSelected
          ? 'border-[var(--ant-color-primary)]! bg-[var(--ant-color-primary-bg-hover)]'
          : 'hover:border-[var(--ant-color-primary)] hover:shadow-xs'
      }`}
      onClick={() => {
        if (selectMode) {
          props.onToggleSelect()
        } else {
          props.onSelectCard()
        }
      }}
      classNames={{ body: 'p-4! md:p-5! h-full flex flex-col justify-between' }}
    >
      <div>
        {/* 卡片头部 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {selectMode && (
              <Checkbox
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation()
                  props.onToggleSelect()
                }}
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <Avatar
              shape="square"
              size={38}
              icon={
                isGithub ? (
                  <GithubOutlined className="text-base text-[var(--ant-color-text)]" />
                ) : (
                  <GlobalOutlined className="text-base text-[var(--ant-color-primary)]" />
                )
              }
              className="bg-[var(--ant-color-fill-secondary)] shrink-0"
            />
            <div className="min-w-0 flex-1">
              <Typography.Text strong className="block truncate text-base leading-snug">
                {library.name}
              </Typography.Text>
              <Typography.Text type="secondary" className="block truncate text-xs font-mono mt-0.5">
                {library.url}
              </Typography.Text>
            </div>
          </div>

          <CrawlStatusTag status={crawlStatus} />
        </div>

        {(library.category || library.version) && (
          <Space wrap size="small" className="mt-3">
            {library.category && <Tag color="blue">{library.category}</Tag>}
            {library.version && <Tag>版本 {library.version}</Tag>}
          </Space>
        )}

        {/* 运行中进度条 */}
        {isRunning && (
          <div
            className="mt-3 rounded-lg bg-[var(--ant-color-fill-quaternary)] p-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[var(--ant-color-text-secondary)]">正在抓取页面...</span>
              <span className="font-mono font-medium">
                {processed} / {discovered || '?'}
              </span>
            </div>
            <Progress percent={percent} size="small" status="active" />
            {progress?.currentUrl && (
              <div className="truncate text-[10px] text-[var(--ant-color-text-tertiary)] font-mono mt-1">
                {progress.currentUrl}
              </div>
            )}
          </div>
        )}

        {/* 抓取异常或失败明细 */}
        {!isRunning &&
          (crawlStatus?.error || (crawlStatus?.failures && crawlStatus.failures.length > 0)) && (
            <div
              className="mt-2.5 rounded bg-[var(--ant-color-error-bg)] p-2 text-xs text-[var(--ant-color-error)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate flex-1 font-medium">
                  {crawlStatus.error || '部分页面抓取失败'}
                </span>
                {crawlStatus.failures && crawlStatus.failures.length > 0 && (
                  <Popover
                    placement="bottomLeft"
                    title={
                      <span className="text-xs font-semibold">
                        失败明细（共 {crawlStatus.failures.length} 条）
                      </span>
                    }
                    content={
                      <div className="max-h-60 max-w-sm overflow-y-auto space-y-2 py-1 text-xs">
                        {crawlStatus.failures.map((f, idx) => (
                          <div
                            key={idx}
                            className="border-b border-[var(--ant-color-split)] pb-1.5 last:border-b-0"
                          >
                            <div className="font-mono text-[11px] text-[var(--ant-color-text)] break-all">
                              {f.url}
                            </div>
                            <div className="text-[11px] text-[var(--ant-color-error)] mt-0.5">
                              {f.message}
                            </div>
                          </div>
                        ))}
                      </div>
                    }
                    trigger="click"
                  >
                    <Button
                      size="small"
                      type="link"
                      danger
                      className="p-0! h-auto text-xs shrink-0 underline"
                    >
                      查看明细 ({crawlStatus.failures.length})
                    </Button>
                  </Popover>
                )}
              </div>
            </div>
          )}

        {/* 核心指标统计 */}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[var(--ant-color-text-secondary)]">
          <div className="flex items-center gap-1">
            <FileTextOutlined className="text-[var(--ant-color-text-tertiary)]" />
            <span className="font-semibold text-[var(--ant-color-text)]">
              {library.pageCount}
            </span>{' '}
            页
          </div>
          <div className="h-3 w-px bg-[var(--ant-color-split)]" />
          <div className="flex items-center gap-1">
            <span>语言:</span>
            <span>{library.languages?.length ? library.languages.join(', ') : '通用'}</span>
          </div>
          {library.lastUpdated && (
            <>
              <div className="h-3 w-px bg-[var(--ant-color-split)]" />
              <span>更新于 {formatDateTime(library.lastUpdated)}</span>
            </>
          )}
        </div>
      </div>

      {/* 底部快捷操作栏 */}
      <div
        className="mt-4 flex items-center justify-between border-t border-[var(--ant-color-split)] pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Space size={6}>
          {isRunning ? (
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              取消抓取
            </Button>
          ) : (
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              更新
            </Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={props.onEdit}>
            配置
          </Button>
          <Popconfirm
            title={`确认删除文档库「${library.name}」？`}
            description="删除后将清空本机存储的全部文档与全文检索索引。"
            okText="删除文档库"
            okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
            cancelText="取消"
            onConfirm={() => deleteMutation.mutate()}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>

        <Button
          type="link"
          size="small"
          onClick={props.onSelectCard}
          className="p-0! flex items-center gap-1 text-xs"
        >
          <span>进入工作台</span>
          <RightOutlined className="text-[10px]" />
        </Button>
      </div>
    </Card>
  )
}

function CrawlStatusTag({ status }: { status?: LibraryCrawlStatus | null }): React.JSX.Element {
  if (!status) return <Tag className="text-[10px]">就绪</Tag>
  if (status.status === 'running') {
    return (
      <Tag color="processing" icon={<SyncOutlined spin />} className="text-[10px]">
        抓取中
      </Tag>
    )
  }
  if (status.status === 'completed') {
    return (
      <Tag color="success" className="text-[10px]">
        已完成
      </Tag>
    )
  }
  if (status.status === 'completed_with_errors') {
    const title =
      status.error ??
      (status.failures?.length
        ? `部分页面抓取失败（共 ${status.failures.length} 处失败）`
        : '部分页面抓取失败，已保留成功内容')
    return (
      <Tooltip title={title}>
        <Tag color="warning" className="text-[10px]">
          部分成功
        </Tag>
      </Tooltip>
    )
  }
  if (status.status === 'failed') {
    const title =
      status.error ??
      (status.failures?.length
        ? `抓取失败（共 ${status.failures.length} 处失败）`
        : '全部页面抓取失败')
    return (
      <Tooltip title={title}>
        <Tag color="error" className="text-[10px]">
          抓取失败
        </Tag>
      </Tooltip>
    )
  }
  if (status.status === 'cancelled') {
    return (
      <Tag color="default" className="text-[10px]">
        已取消
      </Tag>
    )
  }
  return <Tag className="text-[10px]">就绪</Tag>
}
