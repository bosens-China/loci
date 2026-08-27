import { Alert, Button, Card, Empty, Skeleton } from 'antd'

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
      <Card>
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
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
      <Card className="py-16">
        <Empty description={props.emptyText} />
      </Card>
    )
  }
  return <>{props.children}</>
}
