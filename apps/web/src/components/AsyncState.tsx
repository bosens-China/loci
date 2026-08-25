import { Alert, Button, Empty, Skeleton } from 'antd'

interface AsyncStateProps {
  loading: boolean
  error?: Error | null
  empty?: boolean
  emptyText?: string
  onRetry?: () => void
  children: React.ReactNode
}

export function AsyncState(props: AsyncStateProps): React.JSX.Element {
  if (props.loading) {
    return (
      <div className="panel p-6">
        <Skeleton active paragraph={{ rows: 5 }} />
      </div>
    )
  }
  if (props.error) {
    return (
      <Alert
        type="error"
        showIcon
        title="读取失败"
        description={props.error.message}
        action={props.onRetry ? <Button onClick={props.onRetry}>重试</Button> : undefined}
      />
    )
  }
  if (props.empty) {
    return (
      <div className="panel py-16">
        <Empty description={props.emptyText} />
      </div>
    )
  }
  return <>{props.children}</>
}
