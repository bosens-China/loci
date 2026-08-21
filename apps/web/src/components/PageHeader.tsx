interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

/** 内容页通用标题区，仅用于非全屏工作区页面。 */
export function PageHeader(props: PageHeaderProps): React.JSX.Element {
  return (
    <header className="mb-6 flex items-end justify-between gap-6">
      <div>
        <h1 className="mb-0 font-serif text-2xl font-600 tracking-tight text-ink">{props.title}</h1>
        {props.description && (
          <p className="mb-0 mt-1.5 max-w-3xl text-sm leading-6 text-muted">{props.description}</p>
        )}
      </div>
      {props.action}
    </header>
  )
}
