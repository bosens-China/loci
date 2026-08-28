import { useQuery } from '@tanstack/react-query'
import {
  CheckCircleOutlined,
  CloudServerOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  StopOutlined
} from '@ant-design/icons'
import type { ServerBrowserStatus } from '@loci/shared'
import { Alert, Button, Card, Descriptions, Tag, Typography } from 'antd'
import { getAdminBrowserStatus } from '@/api/admin'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { formatDateTime } from '@/utils/format'

const SERVER_BROWSER_KEY = ['admin-browser'] as const

/** Server 页面只诊断镜像内 Chromium 或 Browserless，不修改远端安装文件。 */
export function ServerBrowserPanel(): React.JSX.Element {
  const query = useQuery({ queryKey: SERVER_BROWSER_KEY, queryFn: getAdminBrowserStatus })
  return (
    <div className="space-y-4">
      <PageHeader
        title="Server 浏览器"
        description="检查远端 Loci Server 用于动态文档渲染的浏览器提供方和连接状态。"
        action={
          <Button
            icon={<ReloadOutlined />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            重新检测
          </Button>
        }
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && <ServerStatusContent status={query.data} />}
      </AsyncState>
    </div>
  )
}

function ServerStatusContent({ status }: { status: ServerBrowserStatus }): React.JSX.Element {
  const view = serverStatusView(status)
  return (
    <>
      <Card className="border-[var(--ant-color-border-secondary)] shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className={view.iconClass}>{view.icon}</div>
            <div>
              <Typography.Title level={4} className="mb-1!">
                {view.title}
              </Typography.Title>
              <Typography.Text type="secondary">{view.description}</Typography.Text>
            </div>
          </div>
          <Tag color={view.tagColor}>{providerLabel(status.provider)}</Tag>
        </div>
        {status.error && (
          <Alert
            type="error"
            showIcon
            className="mt-4"
            title="浏览器检测失败"
            description={status.error}
          />
        )}
      </Card>

      <Card
        size="small"
        title="Server 运行环境"
        className="mt-4 border-[var(--ant-color-border-secondary)] shadow-xs"
      >
        <Descriptions
          size="small"
          column={2}
          items={[
            { key: 'provider', label: '浏览器提供方', children: providerLabel(status.provider) },
            { key: 'checked', label: '最后检测', children: formatDateTime(status.checkedAt) },
            { key: 'playwright', label: 'Playwright 版本', children: status.playwrightVersion },
            { key: 'chromium', label: 'Chromium 版本', children: status.chromiumVersion ?? '—' },
            ...(status.endpoint
              ? [
                  {
                    key: 'endpoint',
                    label: 'Browserless 地址',
                    span: 2,
                    children: (
                      <Typography.Text code copyable className="break-all text-xs">
                        {status.endpoint}
                      </Typography.Text>
                    )
                  }
                ]
              : [])
          ]}
        />
      </Card>

      <Alert
        className="mt-4"
        type="info"
        showIcon
        title="部署边界"
        description={providerDescription(status.provider)}
      />
    </>
  )
}

function serverStatusView(status: ServerBrowserStatus): {
  title: string
  description: string
  icon: React.ReactNode
  iconClass: string
  tagColor: string
} {
  if (status.provider === 'disabled') {
    return {
      title: 'Server 未启用浏览器渲染',
      description: 'HTTP 文档仍可同步；动态站点需要在部署配置中启用浏览器提供方。',
      icon: <StopOutlined />,
      iconClass:
        'flex h-11 w-11 items-center justify-center rounded-full bg-[var(--ant-color-fill-secondary)] text-xl text-[var(--ant-color-text-tertiary)]',
      tagColor: 'default'
    }
  }
  if (!status.available) {
    return {
      title: 'Server 浏览器不可用',
      description: '提供方已经配置，但当前无法启动或连接。',
      icon: <ExclamationCircleOutlined />,
      iconClass:
        'flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-xl text-red-600 dark:bg-red-950/50 dark:text-red-400',
      tagColor: 'error'
    }
  }
  return {
    title: 'Server 浏览器已就绪',
    description:
      status.provider === 'local'
        ? 'Server 可以启动镜像内的 Chromium headless shell。'
        : 'Server 已成功连接 Browserless 浏览器服务。',
    icon: status.provider === 'local' ? <CheckCircleOutlined /> : <CloudServerOutlined />,
    iconClass:
      'flex h-11 w-11 items-center justify-center rounded-full bg-green-50 text-xl text-green-600 dark:bg-green-950/50 dark:text-green-400',
    tagColor: 'success'
  }
}

function providerLabel(provider: ServerBrowserStatus['provider']): string {
  return provider === 'local'
    ? '本地 Chromium'
    : provider === 'browserless'
      ? 'Browserless'
      : '未配置'
}

function providerDescription(provider: ServerBrowserStatus['provider']): string {
  if (provider === 'local')
    return '本地 Chromium 由 Loci Server 镜像构建时安装；升级或修复请重新构建并部署镜像。'
  if (provider === 'browserless')
    return 'Browserless 地址和令牌来自 Server 环境变量；页面只显示移除凭据与查询参数后的地址。'
  return '设置 LOCI_BROWSER_PROVIDER 后重新部署 Server；本页面不在运行中的容器内安装或卸载浏览器。'
}
