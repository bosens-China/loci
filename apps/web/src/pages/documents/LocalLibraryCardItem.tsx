import {
  DeleteOutlined,
  EditOutlined,
  GithubOutlined,
  GlobalOutlined,
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
  Tag,
  Typography,
  type ButtonProps
} from 'antd'
import type { LibraryCrawlStatus, LibrarySummary } from '@loci/shared'
import { cancelLibraryCrawl, deleteLibrary, syncLibrary } from '@/api/libraries'
import { CrawlStatusLine } from '@/pages/documents/LibraryCrawlStatusView'

export interface LocalLibraryCardItemProps {
  library: LibrarySummary
  crawlStatus?: LibraryCrawlStatus | null
  isSelected: boolean
  selectMode: boolean
  onSelectCard: () => void
  onToggleSelect: () => void
  onEdit: () => void
}

/** 阻止卡片底部操作冒泡到卡片点击（进入工作台或切换选中）。 */
const stopPropagation = (event: React.MouseEvent): void => event.stopPropagation()

/**
 * 单张本地文档库卡片：标准 Ant Design Card 结构，所有区块固定单行高度保证网格等高。
 * 头部为来源图标、名称与地址；摘要行为页面数、语言与标签；状态行展示抓取进度或结果；底部 actions 为快捷操作。
 */
export function LocalLibraryCardItem(props: LocalLibraryCardItemProps): React.JSX.Element {
  const { library, crawlStatus, isSelected, selectMode } = props
  const { message } = App.useApp()
  const client = useQueryClient()

  const invalidate = (): void => {
    void client.invalidateQueries({ queryKey: ['libraries'] })
    void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
  }

  // 触发单库全量更新
  const syncMutation = useMutation({
    mutationFn: () => syncLibrary(library.id),
    onSuccess: () => {
      invalidate()
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
      invalidate()
      void message.success('文档库已删除')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const isGithub = library.kind === 'github'
  const isRunning = crawlStatus?.status === 'running'

  // 底部操作统一为中性色文字按钮；危险性由 Popconfirm 承担，避免每张卡片都出现红色
  const actions = [
    isRunning ? (
      <ActionButton
        key="cancel"
        disabled={selectMode}
        icon={<StopOutlined />}
        loading={cancelMutation.isPending}
        onClick={() => cancelMutation.mutate()}
      >
        取消抓取
      </ActionButton>
    ) : (
      <ActionButton
        key="sync"
        disabled={selectMode}
        icon={<SyncOutlined />}
        loading={syncMutation.isPending}
        onClick={() => syncMutation.mutate()}
      >
        更新
      </ActionButton>
    ),
    <ActionButton key="edit" disabled={selectMode} icon={<EditOutlined />} onClick={props.onEdit}>
      配置
    </ActionButton>,
    <Popconfirm
      key="delete"
      title={`确认删除文档库「${library.name}」？`}
      description="删除后将清空本机存储的全部文档与全文检索索引。"
      okText="删除文档库"
      okButtonProps={{ danger: true, loading: deleteMutation.isPending }}
      cancelText="取消"
      disabled={selectMode}
      onConfirm={() => deleteMutation.mutateAsync()}
    >
      <ActionButton disabled={selectMode} icon={<DeleteOutlined />}>
        删除
      </ActionButton>
    </Popconfirm>
  ].map((node) => (
    // 选择模式下禁用单卡操作，避免与批量操作混淆
    <div
      key={node.key}
      onClick={stopPropagation}
      className={selectMode ? 'pointer-events-none opacity-40' : ''}
    >
      {node}
    </div>
  ))

  return (
    <Card
      hoverable
      size="small"
      actions={actions}
      onClick={selectMode ? props.onToggleSelect : props.onSelectCard}
      className={`flex h-full cursor-pointer flex-col ${
        isSelected ? 'border-[var(--ant-color-primary)]!' : ''
      }`}
      classNames={{ body: 'flex flex-1 flex-col gap-3 p-4!' }}
    >
      {/* 头部：来源图标、名称与地址；选择模式下右上角显示复选框 */}
      <div className="flex items-center gap-3">
        <Avatar
          shape="square"
          size={40}
          icon={isGithub ? <GithubOutlined /> : <GlobalOutlined />}
          className={`shrink-0 ${
            isGithub
              ? 'bg-[var(--ant-color-fill-secondary)] text-[var(--ant-color-text)]'
              : 'bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)]'
          }`}
        />
        <div className="min-w-0 flex-1">
          <Typography.Text strong className="block truncate text-base">
            {library.name}
          </Typography.Text>
          <Typography.Text type="secondary" className="block truncate text-xs">
            {library.url}
          </Typography.Text>
        </div>
        {selectMode && (
          <Checkbox
            checked={isSelected}
            onClick={stopPropagation}
            onChange={props.onToggleSelect}
          />
        )}
      </div>

      {/* 摘要：页面数与语言在左，分类与版本标签在右，单行固定高度 */}
      <div className="flex h-6 items-center justify-between gap-3">
        <Typography.Text type="secondary" className="min-w-0 truncate text-xs">
          <span className="text-[var(--ant-color-text)] tabular-nums">
            {library.pageCount.toLocaleString()}
          </span>{' '}
          页 · {library.languages?.length ? library.languages.join(', ') : '通用'}
        </Typography.Text>
        <div className="flex shrink-0 items-center gap-1">
          {library.category && (
            <Tag variant="filled" color="blue" className="m-0!">
              {library.category}
            </Tag>
          )}
          {library.version && (
            <Tag variant="filled" className="m-0!">
              {library.version}
            </Tag>
          )}
        </div>
      </div>

      <div
        className="mt-auto border-t border-t-solid border-[var(--ant-color-split)] pt-3"
        onClick={stopPropagation}
      >
        <CrawlStatusLine status={crawlStatus} lastUpdated={library.lastUpdated} />
      </div>
    </Card>
  )
}

/** 卡片底部中性色操作按钮；透传其余属性以便 Popconfirm 等包裹组件注入事件与 ref。 */
function ActionButton(props: ButtonProps): React.JSX.Element {
  return (
    <Button
      type="text"
      size="small"
      {...props}
      className="text-[var(--ant-color-text-secondary)]"
    />
  )
}
