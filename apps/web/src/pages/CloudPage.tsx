import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { CloudCatalogItem } from '@loci/shared'
import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Space,
  Switch,
  Tag,
  Typography
} from 'antd'
import {
  ClockCircleOutlined,
  CloudDownloadOutlined,
  CloudOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  SyncOutlined
} from '@ant-design/icons'
import {
  listCloudCatalog,
  pullCloudLibrary,
  setCloudAutoSync,
  updateCloudLibrary
} from '@/api/cloud'
import { deleteSource } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatBytes, formatDate } from '@/utils/format'
import { LibraryBrowserWorkspace } from '@/pages/documents/LibraryBrowserWorkspace'

type CatalogAction = { item: CloudCatalogItem; run: () => Promise<unknown>; success: string }

/** 云端目录页：从公开目录浏览与拉取文档库快照至本机。 */
export function CloudPage(): React.JSX.Element {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(6)

  const client = useQueryClient()
  const query = useQuery({ queryKey: ['cloud-catalog'], queryFn: listCloudCatalog })

  const action = useMutation({
    mutationFn: ({ run }: CatalogAction) => run(),
    onSuccess: async (_, variables) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['cloud-catalog'] }),
        client.invalidateQueries({ queryKey: ['sources'] }),
        client.invalidateQueries({ queryKey: ['documents'] })
      ])
      void message.success(variables.success)
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const run = (item: CloudCatalogItem, task: () => Promise<unknown>, success: string): void => {
    action.mutate({ item, run: task, success })
  }

  const openLibrary = (sourceId: string): void => {
    void navigate({ to: '/documents', search: { source: sourceId } })
  }

  const busyId = action.isPending ? action.variables?.item.id : null
  const selectedLibrary = query.data?.find((item) => item.id === selectedLibraryId)

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return query.data ?? []
    return (query.data ?? []).filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
    )
  }, [keyword, query.data])

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  if (selectedLibrary) {
    return (
      <LibraryBrowserWorkspace
        location="cloud"
        libraryId={selectedLibrary.id}
        title={selectedLibrary.name}
        onBack={() => setSelectedLibraryId(undefined)}
      />
    )
  }

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="云端公开库"
        description="从公开目录拉取只读快照到本机。阅读走本地 SQLite，离线可用。"
        action={
          <Button
            icon={<ReloadOutlined />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            刷新目录
          </Button>
        }
      />

      <Card size="small" className="mb-5 shadow-xs border-[var(--ant-color-border-secondary)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-[var(--ant-color-text-secondary)]" />}
            placeholder="搜索云端公开库名称或域名..."
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setPage(1)
            }}
            className="max-w-md"
          />
          <Typography.Text type="secondary" className="text-xs">
            云端共有{' '}
            <span className="font-semibold text-[var(--ant-color-text)]">
              {query.data?.length ?? 0}
            </span>{' '}
            个公开文档库
          </Typography.Text>
        </div>
      </Card>

      <AsyncState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyText="当前云服务没有可用的公开文档库"
        onRetry={() => void query.refetch()}
      >
        {pagedItems.length ? (
          <>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              {pagedItems.map((item) => {
                let displayDomain = ''
                try {
                  displayDomain = new URL(item.url).hostname
                } catch {
                  displayDomain = item.url
                }

                return (
                  <Card
                    key={item.id}
                    hoverable
                    className="group flex flex-col justify-between min-w-0 cursor-pointer transition-all duration-200 hover:border-[var(--ant-color-primary)] hover:shadow-sm"
                    onClick={() => setSelectedLibraryId(item.id)}
                  >
                    <div>
                      {/* 卡片头部：Avatar、标题、域名与状态 */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar
                            shape="square"
                            size={40}
                            icon={
                              <CloudOutlined className="text-lg text-cyan-600 dark:text-cyan-400" />
                            }
                            className="shrink-0 flex items-center justify-center rounded-lg bg-cyan-50! dark:bg-cyan-950/50!"
                          />
                          <div className="min-w-0 flex-1">
                            <Typography.Text
                              strong
                              className="block truncate text-[15px] group-hover:text-[var(--ant-color-primary)] transition-colors"
                              title={item.name}
                            >
                              {item.name}
                            </Typography.Text>
                            <Typography.Link
                              className="block truncate font-mono text-xs mt-0.5 text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-primary)]"
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title={item.url}
                            >
                              {displayDomain}
                            </Typography.Link>
                          </div>
                        </div>

                        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                          <CatalogStatus item={item} />
                        </div>
                      </div>

                      {/* 卡片中间第 1 行：指标胶囊与快照标签 */}
                      <div className="mt-3.5 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="rounded-md bg-[var(--ant-color-fill-quaternary)] px-2 py-1 text-xs text-[var(--ant-color-text-secondary)]">
                            📄{' '}
                            <span className="font-semibold text-[var(--ant-color-text)]">
                              {item.pages}
                            </span>{' '}
                            篇
                          </span>
                          <span className="rounded-md bg-[var(--ant-color-fill-quaternary)] px-2 py-1 text-xs text-[var(--ant-color-text-secondary)]">
                            💾 {formatBytes(item.contentSize)}
                          </span>
                        </div>

                        <Tag color="cyan" className="m-0! text-[11px]">
                          云端快照
                        </Tag>
                      </div>

                      {/* 卡片中间第 2 行：独立时间行与本机状态 */}
                      <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--ant-color-text-tertiary)]">
                        <span
                          className="flex items-center gap-1.5 truncate"
                          title={`发布时间: ${formatDate(item.publishedAt)}`}
                        >
                          <ClockCircleOutlined className="text-[11px] shrink-0" />
                          <span className="truncate">发布于 {formatDate(item.publishedAt)}</span>
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--ant-color-text-quaternary)]">
                          {item.localSourceId ? '已拉取到本机' : '未拉取'}
                        </span>
                      </div>
                    </div>

                    {/* 卡片底部操作栏 */}
                    <div
                      className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ant-color-border-secondary)] pt-2.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedLibraryId(item.id)}
                        className="flex items-center gap-1.5 text-xs font-medium text-[var(--ant-color-primary)] hover:opacity-80 transition-opacity bg-transparent border-0 p-0 cursor-pointer"
                      >
                        <FileSearchOutlined />
                        <span>在线预览</span>
                        <RightOutlined className="text-[10px] transition-transform group-hover:translate-x-0.5" />
                      </button>

                      <Space wrap size={6} className="items-center">
                        {item.localSourceId ? (
                          <>
                            <Button
                              size="small"
                              icon={<FolderOpenOutlined />}
                              onClick={() => openLibrary(item.localSourceId!)}
                            >
                              阅读本地
                            </Button>
                            {item.updateAvailable && (
                              <Button
                                type="primary"
                                size="small"
                                icon={<SyncOutlined spin={busyId === item.id} />}
                                loading={busyId === item.id}
                                onClick={() =>
                                  run(
                                    item,
                                    () => updateCloudLibrary(item.localSourceId!),
                                    '云端副本已更新'
                                  )
                                }
                              >
                                更新
                              </Button>
                            )}
                            <Popconfirm
                              title={`移除 ${item.name} 的本地副本？`}
                              description="云端目录不会被删除，之后仍可再次拉取。"
                              okButtonProps={{ danger: true }}
                              onConfirm={() =>
                                run(item, () => deleteSource(item.localSourceId!), '本地副本已移除')
                              }
                            >
                              <Button
                                danger
                                size="small"
                                type="text"
                                icon={<DeleteOutlined />}
                                aria-label="移除本地副本"
                                disabled={busyId === item.id}
                              />
                            </Popconfirm>
                          </>
                        ) : (
                          <Button
                            type="primary"
                            size="small"
                            icon={<CloudDownloadOutlined />}
                            loading={busyId === item.id}
                            onClick={() =>
                              run(item, () => pullCloudLibrary(item.id), '云端文档已拉取')
                            }
                          >
                            拉取到本机
                          </Button>
                        )}

                        {item.localSourceId && (
                          <label className="flex items-center gap-1.5 text-xs text-[var(--ant-color-text-secondary)] ml-1">
                            <span>每日自动检查</span>
                            <Switch
                              size="small"
                              checked={item.autoSync}
                              loading={busyId === item.id}
                              disabled={busyId === item.id}
                              onChange={(enabled) =>
                                run(
                                  item,
                                  () => setCloudAutoSync(item.localSourceId!, enabled),
                                  enabled ? '已开启每日自动检查' : '已关闭自动同步'
                                )
                              }
                            />
                          </label>
                        )}
                      </Space>
                    </div>
                  </Card>
                )
              })}
            </div>

            <div className="mt-6 flex justify-end">
              <Pagination
                current={page}
                pageSize={pageSize}
                total={filtered.length}
                showSizeChanger
                pageSizeOptions={['6', '10', '20']}
                showQuickJumper
                showTotal={(total) => `共 ${total} 个公开库`}
                onChange={(p, ps) => {
                  setPage(p)
                  setPageSize(ps)
                }}
              />
            </div>
          </>
        ) : (
          <Card className="py-16">
            <Empty
              description={keyword ? '未找到匹配的云端库' : '当前云服务没有可用的公开文档库'}
            />
          </Card>
        )}
      </AsyncState>
    </div>
  )
}

function CatalogStatus(props: { item: CloudCatalogItem }): React.JSX.Element {
  const { item } = props
  if (!item.localSourceId) return <Tag className="m-0! text-[11px]">未拉取</Tag>
  return (
    <Tag color={item.updateAvailable ? 'processing' : 'success'} className="m-0! text-[11px]">
      {item.updateAvailable ? '有新版本' : '已在本机'}
    </Tag>
  )
}
