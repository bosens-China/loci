import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd'
import type { BrowserOperationStatus, LocalBrowserStatus } from '@loci/shared'
import { getLocalBrowserStatus, installLocalBrowser, uninstallLocalBrowser } from '@/api/browser'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'

const LOCAL_BROWSER_KEY = ['local-browser'] as const

/** 无头浏览器快捷管理页：对接 GET /api/browser、POST /api/browser/install、DELETE /api/browser。 */
export function BrowserPage(): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()

  // 当操作处于 running 状态时以 1 秒间隔轮询状态
  const query = useQuery({
    queryKey: LOCAL_BROWSER_KEY,
    queryFn: getLocalBrowserStatus,
    refetchInterval: (queryState) => {
      return queryState.state.data?.operation?.state === 'running' ? 1000 : false
    }
  })

  const install = useMutation({
    mutationFn: installLocalBrowser,
    onSuccess: (status) => {
      client.setQueryData(LOCAL_BROWSER_KEY, status)
      void message.success('浏览器安装已启动')
      void query.refetch()
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const uninstall = useMutation({
    mutationFn: uninstallLocalBrowser,
    onSuccess: (status) => {
      client.setQueryData(LOCAL_BROWSER_KEY, status)
      void message.success('浏览器卸载已启动')
      void query.refetch()
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const status = query.data
  const busy = status?.operation?.state === 'running'

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8 space-y-4">
      <PageHeader
        title="无头浏览器"
        description="用于抓取 JavaScript 动态渲染文档站，自动安装与当前 Playwright 匹配的 Chromium headless shell。"
        action={
          <Space wrap>
            <Button
              icon={<ReloadOutlined />}
              loading={query.isFetching && !query.isLoading}
              disabled={busy}
              onClick={() => void query.refetch()}
            >
              重新检测
            </Button>
            {!status?.installed && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                loading={
                  install.isPending ||
                  (status?.operation?.kind === 'install' && status.operation.state === 'running')
                }
                disabled={busy}
                onClick={() => install.mutate()}
              >
                安装浏览器
              </Button>
            )}
          </Space>
        }
      />

      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {status && (
          <div className="space-y-4">
            <RuntimeStatusCard status={status} />
            {status.operation && <OperationCard operation={status.operation} />}
            <EnvironmentCard
              status={status}
              uninstalling={
                uninstall.isPending ||
                (status.operation?.kind === 'uninstall' && status.operation.state === 'running')
              }
              busy={busy}
              onUninstall={() => uninstall.mutate()}
            />
          </div>
        )}
      </AsyncState>
    </div>
  )
}

function RuntimeStatusCard({ status }: { status: LocalBrowserStatus }): React.JSX.Element {
  const view = localStatusView(status)
  return (
    <Card className="border-[var(--ant-color-border-secondary)] shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className={view.iconClass}>{view.icon}</div>
          <div className="min-w-0">
            <Typography.Title level={4} className="mb-1!">
              {view.title}
            </Typography.Title>
            <Typography.Text type="secondary">{view.description}</Typography.Text>
          </div>
        </div>
        <Space wrap className="justify-end">
          <Tag>{`Playwright ${status.playwrightVersion}`}</Tag>
          {status.chromiumVersion && <Tag>{`Chromium ${status.chromiumVersion}`}</Tag>}
          <Typography.Text type="secondary" className="text-xs">
            {`检测于 ${formatDateTime(status.checkedAt)}`}
          </Typography.Text>
        </Space>
      </div>
      {status.error && (
        <Alert
          type="error"
          showIcon
          className="mt-4"
          title="浏览器无法启动"
          description={status.error}
        />
      )}
    </Card>
  )
}

function OperationCard({ operation }: { operation: BrowserOperationStatus }): React.JSX.Element {
  const running = operation.state === 'running'
  return (
    <Card
      size="small"
      title={operation.kind === 'install' ? '浏览器安装进度' : '浏览器卸载进度'}
      extra={
        <Tag color={operationTagColor(operation.state)}>{operationStateLabel(operation.state)}</Tag>
      }
      className="border-[var(--ant-color-border-secondary)] shadow-xs"
    >
      <div className="space-y-3" aria-live="polite">
        <div className="flex items-center gap-3">
          {running && operation.progress === null && <Spin size="small" />}
          <Typography.Text>{operation.message}</Typography.Text>
        </div>
        {operation.progress !== null && (
          <Progress
            percent={operation.progress}
            status={operation.state === 'failed' ? 'exception' : running ? 'active' : 'success'}
          />
        )}
        {operation.error && (
          <Alert type="error" showIcon title="操作失败" description={operation.error} />
        )}
      </div>
    </Card>
  )
}

function EnvironmentCard(props: {
  status: LocalBrowserStatus
  uninstalling: boolean
  busy: boolean
  onUninstall: () => void
}): React.JSX.Element {
  return (
    <Card
      size="small"
      title="运行环境"
      className="border-[var(--ant-color-border-secondary)] shadow-xs"
      extra={
        props.status.installed ? (
          <Popconfirm
            title="卸载无头浏览器？"
            description="卸载后依赖 JavaScript 渲染的文档站将无法通过浏览器同步，后续可随时重新安装。"
            okText="卸载浏览器"
            cancelText="取消"
            okButtonProps={{ danger: true, loading: props.uninstalling }}
            onConfirm={props.onUninstall}
          >
            <Button danger size="small" icon={<DeleteOutlined />} disabled={props.busy}>
              卸载
            </Button>
          </Popconfirm>
        ) : undefined
      }
    >
      <Descriptions
        size="small"
        column={2}
        items={[
          { key: 'playwright', label: 'Playwright 版本', children: props.status.playwrightVersion },
          {
            key: 'chromium',
            label: 'Chromium 版本',
            children: props.status.chromiumVersion ?? '—'
          },
          {
            key: 'path',
            label: '安装目录',
            span: 2,
            children: (
              <Typography.Text code copyable className="break-all text-xs">
                {props.status.executablePath}
              </Typography.Text>
            )
          }
        ]}
      />
    </Card>
  )
}

function localStatusView(status: LocalBrowserStatus): {
  title: string
  description: string
  icon: React.ReactNode
  iconClass: string
} {
  if (status.operation?.state === 'running') {
    return {
      title: status.operation.kind === 'install' ? '正在安装浏览器' : '正在卸载浏览器',
      description: status.operation.message,
      icon: <SyncOutlined spin />,
      iconClass:
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
    }
  }
  if (status.operation?.state === 'failed' || (status.installed && status.launchable === false)) {
    return {
      title: '浏览器需要处理',
      description: status.operation?.error ?? status.error ?? '浏览器已经安装，但当前无法启动。',
      icon: <ExclamationCircleOutlined />,
      iconClass:
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-xl text-red-600 dark:bg-red-950/50 dark:text-red-400'
    }
  }
  if (status.installed && status.launchable) {
    return {
      title: '浏览器已就绪',
      description: '遇到动态站点时，Loci 会启动此 Chromium headless shell 渲染页面。',
      icon: <CheckCircleOutlined />,
      iconClass:
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-50 text-xl text-green-600 dark:bg-green-950/50 dark:text-green-400'
    }
  }
  return {
    title: '尚未安装浏览器',
    description: '普通 HTTP 静态站点无需浏览器；抓取单页 SPA 或动态内容站点前请点击安装。',
    icon: <CloseCircleOutlined />,
    iconClass:
      'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ant-color-fill-secondary)] text-xl text-[var(--ant-color-text-tertiary)]'
  }
}

function operationStateLabel(state: BrowserOperationStatus['state']): string {
  return state === 'running' ? '进行中' : state === 'succeeded' ? '已完成' : '失败'
}

function operationTagColor(state: BrowserOperationStatus['state']): string {
  return state === 'running' ? 'processing' : state === 'succeeded' ? 'success' : 'error'
}
