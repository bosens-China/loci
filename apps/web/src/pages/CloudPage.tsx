import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CloudCatalogItem } from '@loci/shared'
import { App, Button, Popconfirm, Switch, Tag } from 'antd'
import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  ReloadOutlined
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

type CatalogAction = { item: CloudCatalogItem; run: () => Promise<unknown>; success: string }

export function CloudPage(): React.JSX.Element {
  const { message } = App.useApp()
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
    window.history.pushState({}, '', `/library?source=${encodeURIComponent(sourceId)}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  const busyId = action.isPending ? action.variables?.item.id : null

  return (
    <>
      <PageHeader
        eyebrow="Remote shelf"
        title="云端目录"
        description="从公开目录拉取只读快照到本机；阅读仍走本地 SQLite，离线时也能继续使用。"
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
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyText="当前云服务没有可用的公开文档库"
        onRetry={() => void query.refetch()}
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {query.data?.map((item, index) => (
            <article key={item.id} className="panel relative overflow-hidden p-5 sm:p-6">
              <div
                className={`absolute inset-y-0 left-0 w-1.5 ${index % 2 ? 'bg-[#d38a22]' : 'bg-[#3e88a0]'}`}
              />
              <div className="flex items-start justify-between gap-4 pl-2">
                <div className="min-w-0">
                  <h2 className="m-0 truncate font-serif text-xl">{item.name}</h2>
                  <a
                    className="mt-1 block truncate text-xs text-[#0a727b] hover:underline"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {item.url}
                  </a>
                </div>
                <CatalogStatus item={item} />
              </div>
              <div className="my-5 flex flex-wrap gap-2 pl-2">
                <Tag bordered={false}>{item.pages} 页</Tag>
                <Tag bordered={false}>{formatBytes(item.contentSize)}</Tag>
                <Tag bordered={false}>发布 {formatDate(item.publishedAt)}</Tag>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ebeb] pl-2 pt-4">
                <div className="flex flex-wrap gap-2">
                  {item.localSourceId ? (
                    <>
                      <Button
                        icon={<FileSearchOutlined />}
                        onClick={() => openLibrary(item.localSourceId!)}
                      >
                        阅读本地副本
                      </Button>
                      {item.updateAvailable && (
                        <Button
                          type="primary"
                          loading={busyId === item.id}
                          onClick={() =>
                            run(
                              item,
                              () => updateCloudLibrary(item.localSourceId!),
                              '云端副本已更新'
                            )
                          }
                        >
                          更新副本
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
                      icon={<CloudDownloadOutlined />}
                      loading={busyId === item.id}
                      onClick={() =>
                        run(item, () => pullCloudLibrary(item.id), '云端文档已拉取到本机')
                      }
                    >
                      拉取到本机
                    </Button>
                  )}
                </div>
                {item.localSourceId && (
                  <label className="flex items-center gap-2 text-xs text-[#617577]">
                    每日检查
                    <Switch
                      size="small"
                      checked={item.autoSync}
                      loading={busyId === item.id}
                      disabled={busyId === item.id}
                      onChange={(enabled) =>
                        run(
                          item,
                          () => setCloudAutoSync(item.localSourceId!, enabled),
                          enabled ? '已启用云端自动更新' : '已停用云端自动更新'
                        )
                      }
                    />
                  </label>
                )}
              </div>
            </article>
          ))}
        </div>
      </AsyncState>
    </>
  )
}

function CatalogStatus({ item }: { item: CloudCatalogItem }): React.JSX.Element {
  if (!item.localSourceId) return <Tag>未拉取</Tag>
  return (
    <Tag color={item.updateAvailable ? 'processing' : 'success'}>
      {item.updateAvailable ? '有新版本' : '已在本机'}
    </Tag>
  )
}
