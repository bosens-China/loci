import { BookOutlined, FileTextOutlined, GithubOutlined, SyncOutlined } from '@ant-design/icons'
import { Statistic } from 'antd'

interface LibraryOverviewStatsProps {
  total: number
  totalPages: number
  running: number
  github: number
}

/** 知识管理概览指标条：位于白色内容面板内，使用单一分栏容器避免卡片嵌套。 */
export function LibraryOverviewStats(props: LibraryOverviewStatsProps): React.JSX.Element {
  const items = [
    {
      title: '本地文档库',
      value: props.total,
      suffix: '个',
      icon: <BookOutlined className="text-[var(--ant-color-primary)]" />
    },
    {
      title: '已收录页面',
      value: props.totalPages,
      suffix: '页',
      icon: <FileTextOutlined className="text-[var(--ant-color-success)]" />
    },
    {
      title: '进行中抓取',
      value: props.running,
      suffix: '个',
      icon: <SyncOutlined spin={props.running > 0} className="text-[var(--ant-color-warning)]" />
    },
    {
      title: 'GitHub 仓库',
      value: props.github,
      suffix: '个',
      icon: <GithubOutlined className="text-[var(--ant-color-text-secondary)]" />
    }
  ]

  return (
    <div className="grid grid-cols-4 divide-x divide-solid divide-y-0 divide-[var(--ant-color-split)] rounded-lg border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] py-4">
      {items.map((item) => (
        <div key={item.title} className="flex items-center gap-4 px-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--ant-color-bg-container)] text-lg">
            {item.icon}
          </div>
          <Statistic
            title={item.title}
            value={item.value}
            suffix={
              <span className="text-sm text-[var(--ant-color-text-secondary)]">{item.suffix}</span>
            }
          />
        </div>
      ))}
    </div>
  )
}
