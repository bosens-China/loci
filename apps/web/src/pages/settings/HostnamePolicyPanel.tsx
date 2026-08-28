import { useMemo } from 'react'
import {
  APP_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds,
  type HostnameCrawlPolicy,
  type SaveHostnameCrawlPolicyInput
} from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  AutoComplete,
  Button,
  Card,
  Empty,
  Form,
  InputNumber,
  Popconfirm,
  Tag,
  Typography
} from 'antd'
import {
  deleteHostnameCrawlPolicy,
  listHostnameCrawlPolicies,
  saveHostnameCrawlPolicy
} from '@/api/settings'
import { listSources } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'

const POLICY_KEY = ['settings', 'hostname-policies'] as const
type PolicyForm = Omit<SaveHostnameCrawlPolicyInput, 'hostname'> & { hostname?: string }

interface HostnamePolicyPanelProps {
  queryKey?: readonly unknown[]
  listPolicies?: () => Promise<HostnameCrawlPolicy[]>
  savePolicy?: (input: SaveHostnameCrawlPolicyInput) => Promise<HostnameCrawlPolicy>
  deletePolicy?: (hostname: string) => Promise<unknown>
  hostnames?: string[]
  title?: string
  className?: string
}

export function HostnamePolicyPanel({
  queryKey = POLICY_KEY,
  listPolicies = listHostnameCrawlPolicies,
  savePolicy = saveHostnameCrawlPolicy,
  deletePolicy = deleteHostnameCrawlPolicy,
  hostnames,
  title = '域名抓取限制',
  className = 'mt-5'
}: HostnamePolicyPanelProps = {}): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<PolicyForm>()
  const policies = useQuery({ queryKey, queryFn: listPolicies })
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources, enabled: !hostnames })
  const hostnameOptions = useMemo(
    () =>
      [
        ...new Set(hostnames ?? (sources.data ?? []).map((source) => new URL(source.url).hostname))
      ].map((hostname) => ({ value: hostname, label: hostname })),
    [hostnames, sources.data]
  )
  const save = useMutation({
    mutationFn: savePolicy,
    onSuccess: (policy) => {
      client.setQueryData<HostnameCrawlPolicy[]>(queryKey, (current = []) =>
        [...current.filter((item) => item.hostname !== policy.hostname), policy].sort((a, b) =>
          a.hostname.localeCompare(b.hostname)
        )
      )
      form.resetFields()
      void message.success('域名策略已保存，将在下一批次生效')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const remove = useMutation({
    mutationFn: deletePolicy,
    onSuccess: (_, hostname) => {
      client.setQueryData<HostnameCrawlPolicy[]>(queryKey, (current = []) =>
        current.filter((item) => item.hostname !== hostname)
      )
      void message.success('域名策略已删除')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const submit = (value: PolicyForm): void => {
    if (!value.hostname) return
    const input = normalizePolicy(value.hostname, value)
    if (
      !isValidBatchIntervalRange(
        input.batchIntervalMinSeconds ?? 0,
        input.batchIntervalMaxSeconds ?? 0
      )
    ) {
      form.setFields([{ name: 'batchIntervalMaxSeconds', errors: ['最大值不能小于最小值'] }])
      return
    }
    modal.confirm({
      title: `保存 ${input.hostname} 的抓取策略？`,
      content: '修改会由运行中的任务在下一批次读取，无需重启后台 worker。',
      okText: '保存并生效',
      cancelText: '返回',
      onOk: () => save.mutateAsync(input)
    })
  }

  return (
    <Card className={className} title={title} extra={<Tag color="processing">实时生效</Tag>}>
      <Typography.Paragraph type="secondary" className="mb-4! text-xs">
        同一域名共享队列与策略；留空表示继承全局设置，只填一个间隔时按固定值执行。
      </Typography.Paragraph>
      <Form<PolicyForm> form={form} layout="vertical" onFinish={submit}>
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(7rem,1fr))_auto] md:items-end">
          <Form.Item
            name="hostname"
            label="域名"
            rules={[{ required: true, message: '请选择或输入域名' }]}
            className="mb-0"
          >
            <AutoComplete options={hostnameOptions} placeholder="docs.example.com" />
          </Form.Item>
          <OptionalNumber
            name="httpConcurrency"
            label="HTTP 并发"
            {...APP_SETTINGS_LIMITS.concurrency}
          />
          <OptionalNumber
            name="browserConcurrency"
            label="浏览器并发"
            {...APP_SETTINGS_LIMITS.concurrency}
          />
          <OptionalNumber
            name="batchIntervalMinSeconds"
            label="间隔最小（秒）"
            min={0}
            max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
            batchInterval
          />
          <OptionalNumber
            name="batchIntervalMaxSeconds"
            label="间隔最大（秒）"
            min={0}
            max={APP_SETTINGS_LIMITS.batchIntervalSeconds.max}
            batchInterval
          />
          <Form.Item label=" " className="mb-0">
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存策略
            </Button>
          </Form.Item>
        </div>
      </Form>
      <AsyncState
        loading={policies.isLoading}
        error={policies.error instanceof Error ? policies.error : null}
        onRetry={() => void policies.refetch()}
      >
        <div className="max-h-64 space-y-2 overflow-y-auto pt-2">
          {policies.data?.length ? (
            policies.data.map((policy) => (
              <PolicyRow
                key={policy.hostname}
                policy={policy}
                deleting={remove.isPending && remove.variables === policy.hostname}
                onEdit={() => form.setFieldsValue(policy)}
                onDelete={() => remove.mutate(policy.hostname)}
              />
            ))
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无域名自定义策略" />
          )}
        </div>
      </AsyncState>
    </Card>
  )
}

function PolicyRow(props: {
  policy: HostnameCrawlPolicy
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const policy = props.policy
  return (
    <Card size="small" className="transition-colors hover:bg-[var(--ant-color-fill-quaternary)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Typography.Text strong className="font-mono text-xs">
          {policy.hostname}
        </Typography.Text>
        <Typography.Text type="secondary" className="text-xs">
          HTTP {value(policy.httpConcurrency)} · 浏览器 {value(policy.browserConcurrency)} · 间隔{' '}
          {intervalLabel(policy)}
        </Typography.Text>
        <div className="flex justify-end gap-1">
          <Button size="small" type="text" onClick={props.onEdit}>
            编辑
          </Button>
          <Popconfirm
            title="删除这个域名策略？"
            description="后续批次将恢复使用文档库或全局设置。"
            okText="删除"
            cancelText="返回"
            okButtonProps={{ danger: true }}
            onConfirm={props.onDelete}
          >
            <Button size="small" type="text" danger loading={props.deleting}>
              删除
            </Button>
          </Popconfirm>
        </div>
      </div>
    </Card>
  )
}

function OptionalNumber(props: {
  name: keyof PolicyForm
  label: string
  min: number
  max: number
  batchInterval?: boolean
}): React.JSX.Element {
  return (
    <Form.Item
      name={props.name}
      label={props.label}
      rules={
        props.batchInterval
          ? [
              {
                validator: (_: unknown, input: unknown) =>
                  input === undefined || input === null || isValidBatchIntervalSeconds(input)
                    ? Promise.resolve()
                    : Promise.reject(new Error('请输入 0 或允许范围内的整数'))
              }
            ]
          : undefined
      }
      className="mb-0"
    >
      <InputNumber min={props.min} max={props.max} className="w-full" placeholder="继承" />
    </Form.Item>
  )
}

function normalizePolicy(hostname: string, value: PolicyForm): SaveHostnameCrawlPolicyInput {
  return {
    hostname,
    httpConcurrency: value.httpConcurrency ?? null,
    browserConcurrency: value.browserConcurrency ?? null,
    batchIntervalMinSeconds: value.batchIntervalMinSeconds ?? null,
    batchIntervalMaxSeconds: value.batchIntervalMaxSeconds ?? null
  }
}

function value(input: number | null): string {
  return input === null ? '继承' : String(input)
}

function intervalLabel(policy: HostnameCrawlPolicy): string {
  const min = policy.batchIntervalMinSeconds
  const max = policy.batchIntervalMaxSeconds
  if (min === null && max === null) return '继承'
  if (min === null || min === 0) return `${max ?? 0}s`
  if (max === null || max === 0 || min === max) return `${min}s`
  return `${min}–${max}s`
}
