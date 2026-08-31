import { SearchOutlined } from '@ant-design/icons'
import { Button, DatePicker, Input, Segmented } from 'antd'
import dayjs from 'dayjs'
import type { JobFilters, JobViewStatus } from './job-state'

interface JobFiltersToolbarProps {
  filters: JobFilters
  totalCount: number
  runningCount: number
  pausedCount: number
  completedCount: number
  failedCount: number
  onChange: (filters: JobFilters) => void
}

/** 域名任务列表筛选栏，统一维护筛选值与汇总数量的展示入口。 */
export function JobFiltersToolbar(props: JobFiltersToolbarProps): React.JSX.Element {
  const update = (patch: Partial<JobFilters>): void =>
    props.onChange({ ...props.filters, ...patch })
  const reset = (): void => props.onChange({ query: '', date: '', status: 'all' })

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <Segmented<JobViewStatus | 'all'>
        value={props.filters.status}
        onChange={(status) => update({ status })}
        options={[
          { label: `全部 (${props.totalCount})`, value: 'all' },
          { label: `运行中 (${props.runningCount})`, value: 'running' },
          { label: `已暂停 (${props.pausedCount})`, value: 'paused' },
          { label: `已完成 (${props.completedCount})`, value: 'completed' },
          { label: `失败 (${props.failedCount})`, value: 'failed' }
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          allowClear
          prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
          placeholder="搜索文档名称或任务 ID"
          value={props.filters.query}
          className="w-64"
          onChange={(event) => update({ query: event.target.value })}
        />
        <DatePicker
          placeholder="按日期筛选"
          value={props.filters.date ? dayjs(props.filters.date) : null}
          onChange={(_, date) => update({ date: typeof date === 'string' ? date : '' })}
        />
        {(props.filters.query || props.filters.date || props.filters.status !== 'all') && (
          <Button onClick={reset}>重置</Button>
        )}
      </div>
    </div>
  )
}
