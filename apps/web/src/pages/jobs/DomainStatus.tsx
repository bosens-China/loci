import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PauseOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { Tag } from 'antd'
import { getDomainJobStatus, type HostnameJobGroup } from './job-state'

/** 统一域名概览和详情的状态，避免暂停任务显示成功。 */
export function DomainStatus(
  props: Pick<HostnameJobGroup, 'active' | 'paused' | 'failed' | 'stopped'>
): React.JSX.Element {
  const status = getDomainJobStatus(props)
  if (status === 'running') return <Tag color="processing">{props.active} 运行中</Tag>
  if (status === 'paused')
    return (
      <Tag color="warning" icon={<PauseOutlined />}>
        {props.paused} 已暂停
      </Tag>
    )
  if (status === 'failed')
    return (
      <Tag color="error" icon={<CloseCircleOutlined />}>
        {props.failed} 项异常
      </Tag>
    )
  if (status === 'stopped')
    return (
      <Tag color="warning" icon={<WarningOutlined />}>
        部分结束
      </Tag>
    )
  return (
    <Tag color="success" icon={<CheckCircleOutlined />}>
      全部完成
    </Tag>
  )
}
