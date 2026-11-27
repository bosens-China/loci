import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Badge, Button, Popover, Space, Tag, Typography } from 'antd'
import { checkUpdateNow, getUpdateStatus } from '@/api/update'

const UPDATE_QUERY_KEY = ['app-update-status'] as const

function formatCheckedAt(checkedAt: string | null): string {
  if (!checkedAt) return '尚未完成在线检查'
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return '尚未完成在线检查'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 顶栏版本与更新指示器：非阻塞读取服务端更新状态，有新版本时高亮提示并支持一键复制升级命令或手动重查。 */
export function UpdateIndicator(): React.JSX.Element | null {
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: UPDATE_QUERY_KEY,
    queryFn: ({ signal }) => getUpdateStatus(signal),
    refetchInterval: ({ state }) => (state.data?.checking ? 500 : false),
    staleTime: 5 * 60_000,
    retry: false
  })

  const checkMutation = useMutation({
    mutationFn: checkUpdateNow,
    onMutate: () => queryClient.cancelQueries({ queryKey: UPDATE_QUERY_KEY }),
    onSuccess: (status) => {
      queryClient.setQueryData(UPDATE_QUERY_KEY, status)
      if (status.updateAvailable) {
        void message.info(`发现新版本 v${status.latestVersion}`)
      } else {
        void message.success('当前已是最新版本')
      }
    },
    onError: (error: Error) => {
      void message.error(error.message)
      void queryClient.invalidateQueries({ queryKey: UPDATE_QUERY_KEY })
    }
  })

  const status = query.data
  if (!status) {
    return (
      <Button
        type="text"
        size="small"
        loading={query.isPending}
        onClick={() => void query.refetch()}
      >
        {query.isError ? '重试加载版本' : '正在加载版本'}
      </Button>
    )
  }
  const checking = status.checking || checkMutation.isPending

  const popoverContent = (
    <div className="w-80 space-y-3 py-1">
      <div className="flex items-center justify-between border-b border-[var(--ant-color-border-secondary)] pb-2">
        <Space size={6}>
          <Typography.Text strong className="text-xs">
            版本与更新
          </Typography.Text>
          {status.updateAvailable ? (
            <Tag color="processing" className="m-0! text-[11px]">
              有新版本
            </Tag>
          ) : checking ? (
            <Tag color="processing" className="m-0! text-[11px]">
              检查中
            </Tag>
          ) : status.checkFailed ? (
            <Tag color="error" className="m-0! text-[11px]">
              检查失败
            </Tag>
          ) : status.checkedAt ? (
            <Tag color="success" className="m-0! text-[11px]">
              已是最新
            </Tag>
          ) : (
            <Tag className="m-0! text-[11px]">尚未检查</Tag>
          )}
        </Space>
        <Button
          type="link"
          size="small"
          icon={<ReloadOutlined />}
          loading={checking}
          onClick={() => checkMutation.mutate()}
          className="px-0! text-xs"
        >
          检查更新
        </Button>
      </div>

      <div className="space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[var(--ant-color-text-secondary)]">当前版本</span>
          <Typography.Text code className="text-xs">
            v{status.currentVersion}
          </Typography.Text>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--ant-color-text-secondary)]">最新版本</span>
          <Typography.Text code className="text-xs">
            {status.checkedAt || status.updateAvailable ? `v${status.latestVersion}` : '—'}
          </Typography.Text>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--ant-color-text-secondary)]">最近检查</span>
          <span className="text-[var(--ant-color-text-tertiary)]">
            {formatCheckedAt(status.checkedAt)}
          </span>
        </div>
      </div>

      {status.updateAvailable && (
        <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-alter)] p-2.5 space-y-1.5">
          <Typography.Text className="block text-xs text-[var(--ant-color-text-secondary)]">
            在终端运行以下命令升级：
          </Typography.Text>
          <Typography.Paragraph
            copyable={{ text: status.upgradeCommand }}
            className="mb-0! font-mono text-xs break-all"
          >
            {status.upgradeCommand}
          </Typography.Paragraph>
        </div>
      )}
    </div>
  )

  return (
    <Popover content={popoverContent} trigger={['click']} placement="bottomRight" arrow>
      <Button
        type="text"
        size="small"
        className="flex h-8 items-center gap-1.5 px-2 text-xs text-[var(--ant-color-text-secondary)] hover:text-[var(--ant-color-text)]"
        aria-label={status.updateAvailable ? '发现新版本' : '查看版本与更新'}
      >
        <Badge dot={status.updateAvailable} offset={[2, 0]}>
          <CloudDownloadOutlined
            className={
              status.updateAvailable
                ? 'text-sm text-[var(--ant-color-primary)]'
                : 'text-sm text-[var(--ant-color-text-secondary)]'
            }
          />
        </Badge>
        <span className="font-mono">
          {status.updateAvailable ? `v${status.latestVersion} 可用` : `v${status.currentVersion}`}
        </span>
      </Button>
    </Popover>
  )
}
