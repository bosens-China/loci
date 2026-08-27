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
        <Typography.Title level={2} className="mb-0!">
          {props.title}
        </Typography.Title>
        {props.description && (
          <Typography.Paragraph type="secondary" className="mb-0! mt-1.5! max-w-3xl">
            {props.description}
          </Typography.Paragraph>
        )}
      </div>
      {props.action}
    </header>
  )
}
import { Typography } from 'antd'
