import { Tag, Tooltip } from 'antd'

interface LibraryOriginTagProps {
  origin: 'cloud' | 'server'
  autoSync?: boolean
  compact?: boolean
}

/** 在来源层持续标识数据边界，避免给每篇本地文档重复加标签。 */
export function LibraryOriginTag(props: LibraryOriginTagProps): React.JSX.Element {
  if (props.origin === 'server') {
    return (
      <Tooltip title="配置与发布任务运行在目标 Loci Server">
        <Tag variant="filled" color="geekblue" className="m-0 shrink-0">
          Server 文档库
        </Tag>
      </Tooltip>
    )
  }

  const mode = props.autoSync ? '自动更新' : '手动更新'
  return (
    <Tooltip
      title={
        props.autoSync
          ? '正文已下载到本机；后台每日检查 Server 新快照'
          : '正文已下载到本机；只在手动操作时更新快照'
      }
    >
      <Tag variant="filled" color="cyan" className="m-0 shrink-0">
        {props.compact ? '云端副本' : `云端副本 · ${mode}`}
      </Tag>
    </Tooltip>
  )
}
