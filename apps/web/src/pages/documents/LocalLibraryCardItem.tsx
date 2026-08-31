import {
  ClockCircleOutlined,
  CloudOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  GithubOutlined,
  GlobalOutlined,
  RightOutlined,
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
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import type { DocumentSource, LocalJob } from '@loci/shared'
import { enqueueSourceSync, JOBS_QUERY_KEY } from '@/api/jobs'
import { getJobProgressView, upsertLocalJob } from '@/pages/jobs/job-state'
import { formatBytes } from '@/utils/format'

export interface LocalLibraryCardItemProps {
  source: DocumentSource
  activeJob?: LocalJob
  isSelected: boolean
  selectMode: boolean
  onSelectCard: () => void
  onToggleSelect: () => void
  onEdit: () => void
  onPublish: (source: DocumentSource) => void
  canPublish: boolean
  onDelete: () => void
  isDeleting: boolean
}

/** 单张本地文档库卡片：展示来源类型特征、指标胶囊、独立时间行、收录路径及快捷操作。 */
export function LocalLibraryCardItem(props: LocalLibraryCardItemProps): React.JSX.Element {
  const { source, isSelected, selectMode } = props
  const { message } = App.useApp()
  const client = useQueryClient()

  const sync = useMutation({
    mutationFn: enqueueSourceSync,
    onSuccess: (result) => {
      client.setQueryData<LocalJob[]>(JOBS_QUERY_KEY, (current = []) =>
        upsertLocalJob(current, result.job)
      )
      void client.invalidateQueries({ queryKey: ['sources'] })
      void client.invalidateQueries({ queryKey: JOBS_QUERY_KEY })
      void message.success(
        result.reused ? '已有同步任务，已复用当前进度' : '同步任务已进入后台队列'
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  // 格式化展示的主机名与收录路径
  let displayPath = ''
  try {
    const parsed = new URL(source.url)
    displayPath =
      source.kind === 'github'
        ? parsed.pathname.replace(/^\//, '')
        : `${parsed.hostname}${source.scopePath && source.scopePath !== '/' ? source.scopePath : ''}`
  } catch {
    displayPath = source.url
  }

  const isGithub = source.kind === 'github'
  const isCloud = Boolean(source.cloud)

  return (
    <Card
      hoverable
      className={`group relative flex flex-col justify-between overflow-hidden cursor-pointer transition-all duration-200 ${
        isSelected
          ? 'border-[var(--ant-color-primary)]! bg-[var(--ant-color-primary-bg-hover)]'
          : 'hover:border-[var(--ant-color-primary)] hover:shadow-sm'
      }`}
      onClick={() => {
        if (selectMode) {
          props.onToggleSelect()
        } else {
          props.onSelectCard()
        }
      }}
    >
      <div>
        {/* 卡片头部：图标、多选框、类型与状态 */}
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
              size={40}
              src={source.iconUrl ?? undefined}
              alt=""
              draggable={false}
              icon={
                isGithub ? (
                  <GithubOutlined className="text-lg text-[var(--ant-color-text)]" />
                ) : isCloud ? (
                  <CloudOutlined className="text-lg text-cyan-600 dark:text-cyan-400" />
                ) : (
                  <GlobalOutlined className="text-lg text-[var(--ant-color-primary)]" />
                )
              }
              className={`shrink-0 flex items-center justify-center rounded-lg ${
                isGithub
                  ? 'bg-[var(--ant-color-fill-secondary)]!'
                  : isCloud
                    ? 'bg-cyan-50! dark:bg-cyan-950/50!'
                    : 'bg-blue-50! dark:bg-blue-950/50!'
              }`}
            />
            <div className="min-w-0 flex-1">
              <Typography.Text
                strong
                className="block truncate text-[15px] group-hover:text-[var(--ant-color-primary)] transition-colors"
                title={source.name}
              >
                {source.name}
              </Typography.Text>
              <Typography.Text
                type="secondary"
                className="block truncate font-mono text-xs mt-0.5"
                title={displayPath}
              >
                {displayPath}
              </Typography.Text>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            {isGithub ? (
              <Tag className="m-0! text-[11px] border-0 bg-[var(--ant-color-fill-secondary)]">
                GitHub
              </Tag>
            ) : isCloud ? (
              <Tag color="cyan" className="m-0! text-[11px]">
                云端
              </Tag>
            ) : (
              <Tag color="blue" className="m-0! text-[11px]">
                站点
              </Tag>
            )}
            {source.status === 'attention' && (
              <Tag color="warning" className="m-0! text-[11px]">
                需检查
              </Tag>
            )}
          </div>
        </div>

        {/* 卡片中间第 1 行：指标胶囊与技术特性标签 */}
        <div className="mt-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <span className="rounded-md bg-[var(--ant-color-fill-quaternary)] px-2 py-1 text-xs text-[var(--ant-color-text-secondary)]">
              📄 <span className="font-semibold text-[var(--ant-color-text)]">{source.pages}</span>{' '}
              篇
            </span>
            <span className="rounded-md bg-[var(--ant-color-fill-quaternary)] px-2 py-1 text-xs text-[var(--ant-color-text-secondary)]">
              💾 {formatBytes(source.contentSize)}
            </span>
          </div>

          <div
            className="flex items-center gap-1 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {source.resolvedDiscovery === 'openapi' && (
              <Tag color="orange" className="m-0! text-[11px]">
                OpenAPI
              </Tag>
            )}
            {source.resolvedDiscovery === 'llms' && (
              <Tag color="green" className="m-0! text-[11px]">
                llms.txt
              </Tag>
            )}
            {source.schedule && (
              <Tag className="m-0! text-[11px] border-[var(--ant-color-border-secondary)]">
                ⏱ 定时
              </Tag>
            )}
          </div>
        </div>

        {/* 卡片中间第 2 行：独立时间与同步模式行（彻底杜绝折行高度不一致） */}
        <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--ant-color-text-tertiary)]">
          <span
            className="flex items-center gap-1.5 truncate"
            title={`更新时间: ${source.lastUpdated}`}
          >
            <ClockCircleOutlined className="text-[11px] shrink-0" />
            <span className="truncate">{source.lastUpdated}</span>
          </span>
          <span className="shrink-0 text-[11px] text-[var(--ant-color-text-quaternary)]">
            {source.cloud ? '云端快照' : source.schedule ? '自动调度' : '手动同步'}
          </span>
        </div>
      </div>

      {/* 卡片底部操作栏 */}
      <div
        className="mt-3.5 flex items-center justify-between border-t border-[var(--ant-color-border-secondary)] pt-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={selectMode ? props.onToggleSelect : props.onSelectCard}
          className="flex items-center gap-1.5 text-xs font-medium text-[var(--ant-color-primary)] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer"
        >
          <FolderOpenOutlined />
          <span>{selectMode ? (isSelected ? '已选择' : '点击勾选') : '浏览目录'}</span>
          <RightOutlined className="text-[10px] transition-transform group-hover:translate-x-0.5" />
        </button>

        {!isCloud && !selectMode && (
          <Space size={2} className="items-center">
            {props.canPublish && (
              <Tooltip
                title={source.pages > 0 ? '发布为 Server 公开库' : '请先同步，获取正文后才能发布'}
              >
                <span>
                  <Button
                    type="link"
                    size="small"
                    icon={<CloudUploadOutlined />}
                    disabled={source.pages === 0}
                    onClick={() => props.onPublish(source)}
                  >
                    发布
                  </Button>
                </span>
              </Tooltip>
            )}
            <Button
              type="text"
              size="small"
              icon={<SyncOutlined spin={sync.isPending} />}
              title="立即同步"
              loading={sync.isPending}
              className="text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-primary)]"
              onClick={() => sync.mutate(source.id)}
            />
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              title="编辑配置"
              className="text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-primary)]"
              onClick={props.onEdit}
            />
            <Popconfirm
              title="确认删除该文档库？"
              description="将清除本地所有已抓取文档与离线索引。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={props.onDelete}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                title="删除文档源"
                loading={props.isDeleting}
              />
            </Popconfirm>
          </Space>
        )}
      </div>

      {props.activeJob && <LibrarySyncProgress job={props.activeJob} />}
    </Card>
  )
}

function LibrarySyncProgress(props: { job: LocalJob }): React.JSX.Element {
  const progress = getJobProgressView(props.job)
  if (progress.kind === 'indeterminate') {
    return (
      <div
        aria-label="正在准备同步，页面总数尚未确定"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-[var(--ant-color-fill-secondary)]"
        title="正在准备同步，页面总数尚未确定"
      >
        <div className="h-full w-1/3 animate-pulse bg-[var(--ant-color-primary)] motion-reduce:animate-none" />
      </div>
    )
  }
  return (
    <div
      aria-label={`同步进度 ${progress.percent}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress.percent}
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5"
      role="progressbar"
      title={`同步进度 ${progress.processed}/${progress.total} 页 · ${progress.percent}%`}
    >
      <Progress
        className="m-0! block! leading-none!"
        percent={progress.percent}
        showInfo={false}
        size={['100%', 2]}
        trailColor="transparent"
      />
    </div>
  )
}
