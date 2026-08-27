/** 顶层路由代码加载时保留稳定的页面尺寸。 */
export function PageLoading(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] h-48 animate-pulse bg-[var(--ant-color-bg-container)] motion-reduce:animate-none" />
    </div>
  )
}

export function DocumentsPageLoading(): React.JSX.Element {
  return (
    <div className="h-[calc(100vh-3.25rem)] animate-pulse bg-[var(--ant-color-fill-quaternary)] motion-reduce:animate-none" />
  )
}
