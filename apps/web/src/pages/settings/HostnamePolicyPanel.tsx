import { useMemo } from 'react'
import type { HostnameCrawlPolicy, SaveHostnameCrawlPolicyInput } from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, AutoComplete, Button, Empty, Form, InputNumber, Popconfirm } from 'antd'
import {
  deleteHostnameCrawlPolicy,
  listHostnameCrawlPolicies,
  saveHostnameCrawlPolicy
} from '@/api/settings'
import { listSources } from '@/api/sources'

const POLICY_KEY = ['settings', 'hostname-policies'] as const
type PolicyForm = Omit<SaveHostnameCrawlPolicyInput, 'hostname'> & { hostname?: string }

interface HostnamePolicyPanelProps {
  queryKey?: readonly unknown[]
  listPolicies?: () => Promise<HostnameCrawlPolicy[]>
  savePolicy?: (input: SaveHostnameCrawlPolicyInput) => Promise<HostnameCrawlPolicy>
  deletePolicy?: (hostname: string) => Promise<unknown>
  hostnames?: string[]
  title?: string
}

export function HostnamePolicyPanel({
  queryKey = POLICY_KEY,
  listPolicies = listHostnameCrawlPolicies,
  savePolicy = saveHostnameCrawlPolicy,
  deletePolicy = deleteHostnameCrawlPolicy,
  hostnames,
  title = '域名抓取限制'
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
    modal.confirm({
      title: `保存 ${input.hostname} 的抓取策略？`,
      content: '修改会由运行中的任务在下一批次读取，无需重启后台 worker。',
      okText: '保存并生效',
      cancelText: '返回',
      onOk: () => save.mutateAsync(input)
    })
  }

  return (
    <section className="panel mt-5 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="m-0 text-base font-700">{title}</h2>
          <p className="mb-0 mt-1 text-xs text-muted">
            同一域名共享队列与策略；留空表示继承全局设置，只填一个间隔时按固定值执行。
          </p>
        </div>
        <span className="rounded-full bg-[#e1f1f3] px-2.5 py-1 text-[11px] font-650 text-[#086a72]">
          实时生效
        </span>
      </div>
      <Form<PolicyForm> form={form} layout="vertical" className="mt-4" onFinish={submit}>
        <div className="grid gap-3 md:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(7rem,1fr))_auto] md:items-end">
          <Form.Item
            name="hostname"
            label="域名"
            rules={[{ required: true, message: '请选择或输入域名' }]}
          >
            <AutoComplete options={hostnameOptions} placeholder="docs.example.com" />
          </Form.Item>
          <OptionalNumber name="httpConcurrency" label="HTTP 并发" min={1} max={20} />
          <OptionalNumber name="browserConcurrency" label="浏览器并发" min={1} max={20} />
          <OptionalNumber
            name="batchIntervalMinSeconds"
            label="间隔最小（秒）"
            min={0}
            max={3000}
          />
          <OptionalNumber
            name="batchIntervalMaxSeconds"
            label="间隔最大（秒）"
            min={0}
            max={3000}
          />
          <Form.Item label=" ">
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存策略
            </Button>
          </Form.Item>
        </div>
      </Form>
      <div className="max-h-64 space-y-2 overflow-y-auto">
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
    </section>
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
    <div className="grid gap-3 rounded-xl border border-[#dce6e5] bg-[#fafcfc] px-3 py-3 sm:grid-cols-[minmax(12rem,1fr)_2fr_auto] sm:items-center">
      <span className="truncate font-mono text-xs font-650 text-ink">{policy.hostname}</span>
      <span className="text-xs text-muted">
        HTTP {value(policy.httpConcurrency)} · 浏览器 {value(policy.browserConcurrency)} · 间隔{' '}
        {intervalLabel(policy)}
      </span>
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
  )
}

function OptionalNumber(props: {
  name: keyof PolicyForm
  label: string
  min: number
  max: number
}): React.JSX.Element {
  return (
    <Form.Item name={props.name} label={props.label}>
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
