import { Card, Skeleton } from 'antd'

/** 顶层路由代码加载时保留稳定的页面尺寸。 */
export function PageLoading(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Card>
        <Skeleton active paragraph={{ rows: 4 }} />
      </Card>
    </div>
  )
}

export function DocumentsPageLoading(): React.JSX.Element {
  return (
    <div className="h-[calc(100vh-3.25rem)] p-6">
      <Card className="h-full">
        <Skeleton active paragraph={{ rows: 8 }} />
      </Card>
    </div>
  )
}
