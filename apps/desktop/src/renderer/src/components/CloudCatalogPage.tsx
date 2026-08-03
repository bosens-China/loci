import {
  CloudDownloadOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
  message
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { formatBytes, type CloudCatalogItem } from '@loci/shared'
import { useAppSettings } from '../settings-context'

function CloudCatalogPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { state: settingsState, loading: settingsLoading } = useAppSettings()
  const [items, setItems] = useState<CloudCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setItems(await window.api.listCloudCatalog())
      setError(null)
    } catch (loadError) {
      setError(errorMessage(loadError, '云端目录读取失败'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!settingsLoading) void Promise.resolve().then(reload)
  }, [reload, settingsLoading, settingsState.settings.serverUrl])

  const run = (item: CloudCatalogItem, action: () => Promise<unknown>, success: string): void => {
    setBusyId(item.id)
    void action()
      .then(() => messageApi.success(success))
      .then(reload)
      .catch((actionError: unknown) => messageApi.error(errorMessage(actionError, '操作失败')))
      .finally(() => setBusyId(null))
  }

  const remove = (item: CloudCatalogItem): void => {
    if (!item.localSourceId) return
    run(item, () => window.api.deleteSource(item.localSourceId!), '本地副本已移除')
  }

  return (
    <div className="mx-auto h-full w-full max-w-[1280px] overflow-x-hidden overflow-y-auto pr-1">
      {contextHolder}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Typography.Title level={2} className="mb-1!">
            云端资源
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="mb-0!">
            从 {settingsState.settings.serverUrl} 保存公开文档到本地知识库。
          </Typography.Paragraph>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>
          检查更新
        </Button>
      </div>

      <Alert
        className="mb-5"
        type="info"
        showIcon
        message="云文档按来源后端更新"
        description="更换设置中的后端地址后，旧副本仍可本地读取，但不会再自动或手动同步。"
      />
      {error && (
        <Alert
          className="mb-5"
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => void reload()}>
              重试
            </Button>
          }
        />
      )}

      {loading && items.length === 0 ? (
        <Card>
          <Skeleton active paragraph={{ rows: 8 }} />
        </Card>
      ) : items.length === 0 && !error ? (
        <Card>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前后端还没有已发布的文档库" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="h-full" loading={busyId === item.id}>
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Typography.Title level={4} className="mb-1! truncate">
                      {item.name}
                    </Typography.Title>
                    <Typography.Text type="secondary" className="block truncate font-mono text-xs">
                      {item.url}
                    </Typography.Text>
                  </div>
                  {item.localSourceId ? (
                    <Tag color={item.updateAvailable ? 'processing' : 'success'}>
                      {item.updateAvailable ? '有更新' : '已保存'}
                    </Tag>
                  ) : (
                    <Tag>云端</Tag>
                  )}
                </div>

                <div className="my-5 flex flex-wrap gap-2">
                  <Tag bordered={false}>{item.pages} 页</Tag>
                  <Tag bordered={false}>{formatBytes(item.contentSize)}</Tag>
                  <Tag bordered={false}>发布于 {formatDate(item.publishedAt)}</Tag>
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-t-solid border-t-[var(--ant-color-border-secondary)] pt-4">
                  {item.localSourceId ? (
                    <Space wrap>
                      <Button
                        icon={<FileSearchOutlined />}
                        onClick={() =>
                          void navigate({
                            to: '/library',
                            search: { source: item.localSourceId!, document: undefined }
                          })
                        }
                      >
                        本地阅读
                      </Button>
                      {item.updateAvailable && (
                        <Button
                          type="primary"
                          icon={<CloudDownloadOutlined />}
                          onClick={() =>
                            run(
                              item,
                              () => window.api.updateCloudLibraryCopy(item.localSourceId!),
                              '云文档已更新'
                            )
                          }
                        >
                          拉取更新
                        </Button>
                      )}
                      <Popconfirm
                        title={`移除 ${item.name} 的本地副本？`}
                        description="本地文档和索引会被删除，服务器内容不受影响。"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove(item)}
                      >
                        <Button
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          aria-label="移除本地副本"
                        />
                      </Popconfirm>
                    </Space>
                  ) : (
                    <Button
                      type="primary"
                      icon={<CloudDownloadOutlined />}
                      onClick={() =>
                        run(
                          item,
                          () => window.api.importCloudLibrary(item.id, true),
                          '云文档已保存到本地'
                        )
                      }
                    >
                      保存到本地
                    </Button>
                  )}
                  {item.localSourceId && (
                    <Space size="small">
                      <Typography.Text type="secondary" className="text-xs">
                        每日同步
                      </Typography.Text>
                      <Switch
                        size="small"
                        checked={item.autoSync}
                        onChange={(enabled) =>
                          run(
                            item,
                            () => window.api.setCloudLibraryAutoSync(item.localSourceId!, enabled),
                            enabled ? '已开启每日同步' : '已关闭每日同步'
                          )
                        }
                      />
                    </Space>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value))
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default CloudCatalogPage
