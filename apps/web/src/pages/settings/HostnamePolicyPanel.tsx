import { useMemo, useState } from 'react'
import {
  GlobalOutlined,
  PlusOutlined,
  RedoOutlined,
  SearchOutlined,
  SettingOutlined
} from '@ant-design/icons'
import type { HostnameCrawlPolicy, SaveHostnameCrawlPolicyInput } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from 'antd'
import { deleteHostnameCrawlPolicy, getSettings, listHostnameCrawlPolicies } from '@/api/settings'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { JobConcurrencyModal } from '@/pages/jobs/JobConcurrencyModal'

const POLICY_KEY = ['settings', 'hostname-policies'] as const

interface HostnamePolicyPanelProps {
  queryKey?: readonly unknown[]
  listPolicies?: () => Promise<HostnameCrawlPolicy[]>
  savePolicy?: (input: SaveHostnameCrawlPolicyInput) => Promise<HostnameCrawlPolicy>
  deletePolicy?: (hostname: string) => Promise<unknown>
  hostnames?: string[]
  title?: string
  className?: string
}

interface DomainPolicyItem {
  hostname: string
  sourceNames: string[]
  policy?: HostnameCrawlPolicy
  isCustom: boolean
  httpConcurrency: number | null
  browserConcurrency: number | null
  intervalLabel: string
}

/** 域名抓取策略面板：结构化展示已知域名、全局继承状态与独立并发限速管理。 */
export function HostnamePolicyPanel({
  queryKey = POLICY_KEY,
  listPolicies = listHostnameCrawlPolicies,
  deletePolicy = deleteHostnameCrawlPolicy,
  hostnames,
  title = '域名抓取限制',
  className = 'mt-5'
}: HostnamePolicyPanelProps = {}): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()

  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'custom' | 'inherited'>('all')
  const [modalState, setModalState] = useState<{ open: boolean; hostname?: string }>({
    open: false
  })

  const policies = useQuery({ queryKey, queryFn: listPolicies })
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources, enabled: !hostnames })
  const globalSettings = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const defaultHttp = globalSettings.data?.httpConcurrency ?? 9
  const defaultBrowser = globalSettings.data?.browserConcurrency ?? 5

  const remove = useMutation({
    mutationFn: deletePolicy,
    onSuccess: (_, hostname) => {
      client.setQueryData<HostnameCrawlPolicy[]>(queryKey, (current = []) =>
        current.filter((item) => item.hostname !== hostname)
      )
      void message.success(`已重置 ${hostname} 为继承全局策略`)
    },
    onError: (error: Error) => void message.error(error.message)
  })

  // 整理所有已知域名及其关联的文档库名称
  const domainSourceMap = useMemo(() => {
    const map = new Map<string, string[]>()
    if (sources.data) {
      for (const s of sources.data) {
        try {
          const host = new URL(s.url).hostname
          const list = map.get(host) ?? []
          list.push(s.name)
          map.set(host, list)
        } catch {
          // ignore invalid url
        }
      }
    }
    return map
  }, [sources.data])

  // 汇聚所有已知域名（已配置策略 + 来自文档库/外部 hostnames）
  const allKnownHostnames = useMemo(() => {
    const set = new Set<string>()
    if (hostnames) {
      for (const h of hostnames) set.add(h)
    }
    for (const h of domainSourceMap.keys()) {
      set.add(h)
    }
    if (policies.data) {
      for (const p of policies.data) {
        set.add(p.hostname)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [domainSourceMap, hostnames, policies.data])

  // 组织表格行数据
  const rows: DomainPolicyItem[] = useMemo(() => {
    const policyMap = new Map((policies.data ?? []).map((p) => [p.hostname, p]))

    return allKnownHostnames.map((hostname) => {
      const policy = policyMap.get(hostname)
      const hasCustom = Boolean(
        policy &&
        (policy.httpConcurrency !== null ||
          policy.browserConcurrency !== null ||
          policy.batchIntervalMinSeconds !== null ||
          policy.batchIntervalMaxSeconds !== null)
      )

      return {
        hostname,
        sourceNames: domainSourceMap.get(hostname) ?? [],
        policy,
        isCustom: hasCustom,
        httpConcurrency: policy?.httpConcurrency ?? null,
        browserConcurrency: policy?.browserConcurrency ?? null,
        intervalLabel: formatIntervalLabel(policy)
      }
    })
  }, [allKnownHostnames, domainSourceMap, policies.data])

  // 过滤后的行
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((item) => {
      if (filterType === 'custom' && !item.isCustom) return false
      if (filterType === 'inherited' && item.isCustom) return false
      if (!q) return true
      return (
        item.hostname.toLowerCase().includes(q) ||
        item.sourceNames.some((name) => name.toLowerCase().includes(q))
      )
    })
  }, [filterType, rows, searchQuery])

  const customCount = rows.filter((r) => r.isCustom).length
  const inheritedCount = rows.length - customCount

  const columns: TableColumnsType<DomainPolicyItem> = [
    {
      title: '域名 / 关联文档来源',
      key: 'hostname',
      render: (_, record) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <GlobalOutlined className="text-[var(--ant-color-primary)] text-sm shrink-0" />
            <Typography.Text strong className="font-mono text-sm">
              {record.hostname}
            </Typography.Text>
          </div>
          {record.sourceNames.length > 0 && (
            <div
              className="mt-1 truncate text-sm text-[var(--ant-color-text-secondary)] max-w-sm"
              title={record.sourceNames.join('、')}
            >
              关联来源: {record.sourceNames.join('、')}
            </div>
          )}
        </div>
      )
    },
    {
      title: 'HTTP 并发',
      key: 'httpConcurrency',
      width: 150,
      render: (_, record) =>
        record.httpConcurrency !== null ? (
          <Tag color="blue" className="m-0! text-sm px-2.5 py-0.5">
            HTTP {record.httpConcurrency}
          </Tag>
        ) : (
          <span className="text-sm text-[var(--ant-color-text-secondary)]">
            继承全局 ({defaultHttp})
          </span>
        )
    },
    {
      title: '无头浏览器并发',
      key: 'browserConcurrency',
      width: 160,
      render: (_, record) =>
        record.browserConcurrency !== null ? (
          <Tag color="purple" className="m-0! text-sm px-2.5 py-0.5">
            浏览器 {record.browserConcurrency}
          </Tag>
        ) : (
          <span className="text-sm text-[var(--ant-color-text-secondary)]">
            继承全局 ({defaultBrowser})
          </span>
        )
    },
    {
      title: '请求批次间隔',
      key: 'interval',
      width: 140,
      render: (_, record) =>
        record.isCustom && record.intervalLabel !== '继承全局' ? (
          <Tag color="orange" className="m-0! text-sm px-2.5 py-0.5">
            {record.intervalLabel}
          </Tag>
        ) : (
          <span className="text-sm text-[var(--ant-color-text-secondary)]">不限速 (继承)</span>
        )
    },
    {
      title: '策略状态',
      key: 'status',
      width: 130,
      render: (_, record) =>
        record.isCustom ? (
          <Tag color="processing" className="m-0! text-sm px-2.5 py-0.5">
            已自定义
          </Tag>
        ) : (
          <Tag className="m-0! text-sm px-2.5 py-0.5">继承全局</Tag>
        )
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      align: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            icon={<SettingOutlined />}
            onClick={() => setModalState({ open: true, hostname: record.hostname })}
          >
            {record.isCustom ? '修改策略' : '设置限制'}
          </Button>

          {record.isCustom && (
            <Popconfirm
              title={`重置 ${record.hostname} 为继承全局？`}
              description="删除自定义限制后，该域名将在下一批次恢复使用全局并发与限速设置。"
              okText="重置为继承"
              cancelText="取消"
              onConfirm={() => remove.mutate(record.hostname)}
            >
              <Button
                size="small"
                type="text"
                danger
                icon={<RedoOutlined />}
                loading={remove.isPending && remove.variables === record.hostname}
              >
                重置
              </Button>
            </Popconfirm>
          )}
        </Space>
      )
    }
  ]

  return (
    <div className={className ?? 'space-y-3.5'}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Typography.Title level={4} className="m-0!">
          {title}
        </Typography.Title>
        <Tag color="processing">下一批次生效</Tag>
      </div>
      <Alert
        type="info"
        showIcon
        message="域名独立抓取与并发限速"
        description="同一域名下的所有文档库共享并发队列；自定义配置将优先于全局策略生效，正在运行的任务将在下一批次实时读取最新配置。"
        className="mb-4 text-sm"
      />

      {/* 搜索、过滤与添加操作工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<'all' | 'custom' | 'inherited'>
            value={filterType}
            onChange={setFilterType}
            options={[
              { label: `全部域名 (${rows.length})`, value: 'all' },
              { label: `已自定义限制 (${customCount})`, value: 'custom' },
              { label: `继承全局 (${inheritedCount})`, value: 'inherited' }
            ]}
          />

          <Input
            allowClear
            prefix={<SearchOutlined className="text-[var(--ant-color-text-tertiary)]" />}
            placeholder="搜索域名或关联文档名称"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
        </div>

        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalState({ open: true })}
        >
          添加域名限制
        </Button>
      </div>

      <AsyncState
        loading={policies.isLoading || sources.isLoading}
        error={policies.error instanceof Error ? policies.error : null}
        onRetry={() => void Promise.all([policies.refetch(), sources.refetch()])}
      >
        <Table<DomainPolicyItem>
          rowKey="hostname"
          dataSource={filteredRows}
          columns={columns}
          size="middle"
          pagination={
            filteredRows.length > 10
              ? { pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个域名` }
              : false
          }
          locale={{
            emptyText: <Empty className="py-8" description="暂无符合条件的域名策略" />
          }}
        />
      </AsyncState>

      {/* 域名并发与限速编辑弹窗 */}
      {modalState.open && (
        <JobConcurrencyModal
          key={modalState.hostname ?? 'new-policy'}
          open
          hostname={modalState.hostname}
          availableHostnames={allKnownHostnames}
          onClose={() => setModalState({ open: false })}
        />
      )}
    </div>
  )
}

function formatIntervalLabel(policy?: HostnameCrawlPolicy): string {
  if (!policy) return '继承全局'
  const min = policy.batchIntervalMinSeconds
  const max = policy.batchIntervalMaxSeconds
  if (min === null && max === null) return '继承全局'
  if (min === null || min === 0) return `${max ?? 0}s 间隔`
  if (max === null || max === 0 || min === max) return `${min}s 间隔`
  return `${min}s–${max}s 间隔`
}
