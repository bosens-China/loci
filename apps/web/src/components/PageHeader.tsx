import { Typography } from 'antd'

interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

/** 内容页通用标题区，仅用于非全屏工作区页面；采用后台常规的 20px 标题层级。 */
export function PageHeader(props: PageHeaderProps): React.JSX.Element {
  return (
    <header className="mb-5 flex items-center justify-between gap-6">
      <div className="min-w-0">
        <Typography.Title level={4} className="mb-0!">
          {props.title}
        </Typography.Title>
        {props.description && (
          <Typography.Text type="secondary" className="mt-1 block max-w-3xl">
            {props.description}
          </Typography.Text>
        )}
      </div>
      {props.action}
    </header>
  )
}
