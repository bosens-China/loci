interface PageHeaderProps {
  eyebrow: string
  title: string
  description: string
  action?: React.ReactNode
}

export function PageHeader(props: PageHeaderProps): React.JSX.Element {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="eyebrow">{props.eyebrow}</div>
        <h1 className="mb-0 mt-2 font-serif text-3xl font-600 tracking-tight text-[#172628] sm:text-4xl">
          {props.title}
        </h1>
        <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-[#5f7375]">{props.description}</p>
      </div>
      {props.action}
    </header>
  )
}
