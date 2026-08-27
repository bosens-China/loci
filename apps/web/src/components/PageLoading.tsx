/** 顶层路由代码加载时保留稳定的页面尺寸。 */
export function PageLoading(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="panel h-48 animate-pulse bg-white motion-reduce:animate-none" />
    </div>
  )
}

export function DocumentsPageLoading(): React.JSX.Element {
  return (
    <div className="h-[calc(100vh-3.25rem)] animate-pulse bg-[#f3f7f6] motion-reduce:animate-none" />
  )
}
