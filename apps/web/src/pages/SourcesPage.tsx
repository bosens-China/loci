import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select } from 'antd'
import { PlusOutlined, SyncOutlined } from '@ant-design/icons'
import type { CreateSourceInput, DocumentSource, FetchMode, UpdateSourceInput } from '@loci/shared'
import { enqueueSourceSync } from '@/api/jobs'
import { createSource, deleteSource, listSources, updateSource } from '@/api/sources'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { StatusPill } from '@/components/StatusPill'

interface SourceFormValue {
  name: string
  url: string
  mode: FetchMode
  pageLimit: number
  scopePath: string
  excludePathPattern?: string
  schedule?: string
}

export function SourcesPage(): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [editing, setEditing] = useState<DocumentSource | 'new' | null>(null)
  const [form] = Form.useForm<SourceFormValue>()
  const query = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['sources'] })
    void client.invalidateQueries({ queryKey: ['jobs'] })
  }
  const save = useMutation({
    mutationFn: async (value: SourceFormValue) => {
      const input = toInput(value, editing === 'new' ? null : editing)
      return editing === 'new' ? createSource(input) : updateSource(editing!.id, input)
    },
    onSuccess: () => {
      setEditing(null)
      refresh()
      void message.success('文档来源已保存')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const remove = useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      refresh()
      void message.success('文档来源已删除')
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const sync = useMutation({
    mutationFn: enqueueSourceSync,
    onSuccess: (result) => {
      refresh()
      void message.success(
        result.reused ? '已有同步任务，已复用当前进度' : '同步任务已进入后台队列'
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })
  const open = (source: DocumentSource | 'new'): void => {
    setEditing(source)
    form.setFieldsValue(source === 'new' ? emptyForm : fromSource(source))
  }

  return (
    <>
      <PageHeader
        eyebrow="Source index"
        title="文档来源"
        description="每个来源像一册持续更新的索引。重复点击同步只会复用同一个活动任务。"
        action={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
            添加来源
          </Button>
        }
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyText="添加第一个文档来源"
        onRetry={() => void query.refetch()}
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {query.data?.map((source, index) => (
            <article key={source.id} className="panel group relative overflow-hidden pl-2">
              <div
                className={`absolute inset-y-0 left-0 w-2 ${index % 3 === 0 ? 'bg-[#0a7c86]' : index % 3 === 1 ? 'bg-[#c77a17]' : 'bg-[#476d91]'}`}
              />
              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 truncate font-serif text-xl font-600">{source.name}</h2>
                      <StatusPill status={source.status} />
                    </div>
                    <a
                      className="mt-2 block truncate text-xs text-[#0a727b] hover:underline"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {source.url}
                    </a>
                  </div>
                  <div className="font-mono text-right text-[11px] text-[#718486]">
                    <div>{source.pages} pages</div>
                    <div className="mt-1">{source.mode}</div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 border-y border-[#e7eded] py-4 text-xs sm:grid-cols-3">
                  <Datum label="收录范围" value={source.scopePath} />
                  <Datum label="页面上限" value={String(source.pageLimit)} />
                  <Datum label="定时计划" value={source.schedule ?? '未启用'} />
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Popconfirm
                    title="删除这个来源及其本地文档？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => remove.mutate(source.id)}
                  >
                    <Button
                      danger
                      type="text"
                      loading={remove.isPending && remove.variables === source.id}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                  {!source.cloud && <Button onClick={() => open(source)}>编辑</Button>}
                  {source.cloud ? (
                    <Button disabled>云端副本</Button>
                  ) : (
                    <Button
                      type="primary"
                      icon={<SyncOutlined spin={sync.isPending && sync.variables === source.id} />}
                      loading={sync.isPending && sync.variables === source.id}
                      onClick={() => sync.mutate(source.id)}
                    >
                      后台同步
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </AsyncState>
      <Modal
        title={editing === 'new' ? '添加文档来源' : '编辑文档来源'}
        open={editing !== null}
        okText="保存"
        cancelText="取消"
        confirmLoading={save.isPending}
        onCancel={() => setEditing(null)}
        onOk={() => void form.validateFields().then((value) => save.mutate(value))}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="pt-3" requiredMark="optional">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="url"
            label="起始 URL"
            rules={[{ required: true, type: 'url', message: '请输入完整 URL' }]}
          >
            <Input placeholder="https://example.com/docs" />
          </Form.Item>
          <div className="grid grid-cols-2 gap-3">
            <Form.Item name="mode" label="抓取方式">
              <Select
                options={[
                  { value: 'auto', label: '自动检测' },
                  { value: 'http', label: 'HTTP' },
                  { value: 'browser', label: '浏览器' }
                ]}
              />
            </Form.Item>
            <Form.Item name="pageLimit" label="页面上限">
              <InputNumber min={1} max={100000} className="w-full" />
            </Form.Item>
          </div>
          <Form.Item name="scopePath" label="收录路径">
            <Input placeholder="/docs" />
          </Form.Item>
          <Form.Item name="excludePathPattern" label="排除路径（可选）">
            <Input placeholder="/archive/**" />
          </Form.Item>
          <Form.Item
            name="schedule"
            label="定时计划（可选）"
            extra="支持 5 段 cron，例如 0 9 * * 1"
          >
            <Input placeholder="0 9 * * 1" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function Datum({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[#7a8c8e]">{label}</div>
      <div className="mt-1 truncate font-mono text-[#304a4d]">{value}</div>
    </div>
  )
}

const emptyForm: SourceFormValue = {
  name: '',
  url: '',
  mode: 'auto',
  pageLimit: 100,
  scopePath: '/'
}

function fromSource(source: DocumentSource): SourceFormValue {
  return {
    name: source.name,
    url: source.url,
    mode: source.mode,
    pageLimit: source.pageLimit,
    scopePath: source.scopePath,
    excludePathPattern: source.excludePathPattern ?? undefined,
    schedule: source.schedule ?? undefined
  }
}

function toInput(
  value: SourceFormValue,
  source: DocumentSource | null
): CreateSourceInput | UpdateSourceInput {
  return {
    name: value.name.trim(),
    url: value.url.trim(),
    mode: value.mode,
    pageLimit: value.pageLimit,
    scopePath: value.scopePath.trim() || '/',
    excludePathPattern: value.excludePathPattern?.trim() || null,
    schedule: value.schedule?.trim() || null,
    httpConcurrency: source?.httpConcurrency ?? null,
    browserConcurrency: source?.browserConcurrency ?? null,
    githubArchiveLimitMb: source?.githubArchiveLimitMb ?? null,
    githubMarkdownLimitMb: source?.githubMarkdownLimitMb ?? null
  }
}
