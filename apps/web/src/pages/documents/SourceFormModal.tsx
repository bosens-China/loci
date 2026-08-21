import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  type CreateSourceInput,
  type CreateSourceResult,
  type DocumentSource,
  type FetchMode,
  type UpdateSourceInput
} from '@loci/shared'
import { enqueueSourceSync } from '@/api/jobs'
import { createSource, deleteSource, updateSource } from '@/api/sources'

interface SourceFormValue {
  name: string
  url: string
  mode: FetchMode
  pageLimit: number
  scopePath: string
  excludePathPattern?: string
  schedule?: string
  httpConcurrency?: number
  browserConcurrency?: number
  githubArchiveLimitMb?: number
  githubMarkdownLimitMb?: number
}

interface SourceFormModalProps {
  editing: DocumentSource | 'new' | null
  onClose: () => void
  onSaved: () => void
}

export function SourceFormModal(props: SourceFormModalProps): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<SourceFormValue>()
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['sources'] })
    void client.invalidateQueries({ queryKey: ['jobs'] })
  }
  const save = useMutation({
    mutationFn: async (value: SourceFormValue) => {
      const input = toInput(value)
      if (props.editing === 'new') return createSource(input)
      const source = await updateSource(props.editing!.id, input)
      return { source, sync: null, workerError: null } satisfies CreateSourceResult
    },
    onSuccess: ({ sync, workerError }) => {
      props.onClose()
      refresh()
      props.onSaved()
      if (workerError) {
        void message.warning(`文档来源已保存，首次同步已排队，但后台启动失败：${workerError}`)
        return
      }
      void message.success(
        sync
          ? sync.reused
            ? '文档来源已保存；已复用正在进行的首次同步'
            : '文档来源已保存；首次同步已在后台开始'
          : '文档来源已保存'
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  return (
    <Modal
      title={props.editing === 'new' ? '添加文档来源' : '编辑文档来源'}
      open={props.editing !== null}
      okText="保存"
      cancelText="取消"
      confirmLoading={save.isPending}
      onCancel={props.onClose}
      onOk={() => void form.validateFields().then((value) => save.mutate(value))}
      destroyOnHidden
      afterOpenChange={(open) => {
        if (!open) return
        form.setFieldsValue(
          props.editing === 'new' || !props.editing ? emptyForm : fromSource(props.editing)
        )
      }}
    >
      <Form form={form} layout="vertical" className="pt-2" requiredMark="optional">
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: '请输入名称' },
            { max: DOCUMENT_SOURCE_LIMITS.nameLength.max, message: '名称过长' }
          ]}
        >
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
            <InputNumber {...DOCUMENT_SOURCE_LIMITS.pageLimit} className="w-full" />
          </Form.Item>
        </div>
        <Form.Item name="scopePath" label="收录路径">
          <Input placeholder="/docs" />
        </Form.Item>
        <Form.Item
          name="excludePathPattern"
          label="排除路径正则（可选）"
          rules={[
            { max: DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max, message: '正则过长' }
          ]}
        >
          <Input placeholder="^/(zh|de|fr)(?:/|$)" />
        </Form.Item>
        <Form.Item name="schedule" label="定时计划（可选）" extra="5 段 cron，例如 0 9 * * 1">
          <Input placeholder="0 9 * * 1" />
        </Form.Item>
        <div className="grid grid-cols-2 gap-3">
          <OptionalNumberField name="httpConcurrency" label="HTTP 并发覆盖" />
          <OptionalNumberField name="browserConcurrency" label="浏览器并发覆盖" />
          <OptionalNumberField name="githubArchiveLimitMb" label="GitHub ZIP 上限（MB）" size />
          <OptionalNumberField
            name="githubMarkdownLimitMb"
            label="GitHub Markdown 上限（MB）"
            size
          />
        </div>
      </Form>
    </Modal>
  )
}

interface SourceActionsProps {
  source: DocumentSource
  onEdit: () => void
  compact?: boolean
}

/** 来源行内操作：同步、编辑、删除。 */
export function SourceActions(props: SourceActionsProps): React.JSX.Element {
  const { message } = App.useApp()
  const client = useQueryClient()
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['sources'] })
    void client.invalidateQueries({ queryKey: ['jobs'] })
  }
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

  if (props.source.cloud) {
    return <span className="text-[11px] text-muted">云端副本</span>
  }

  return (
    <div className={`flex gap-1 ${props.compact ? '' : 'mt-2'}`}>
      <Button
        type="text"
        size="small"
        icon={<SyncOutlined spin={sync.isPending} />}
        loading={sync.isPending}
        onClick={(event) => {
          event.stopPropagation()
          sync.mutate(props.source.id)
        }}
      >
        {props.compact ? undefined : '同步'}
      </Button>
      <Button
        type="text"
        size="small"
        onClick={(event) => {
          event.stopPropagation()
          props.onEdit()
        }}
      >
        编辑
      </Button>
      <Popconfirm
        title="删除这个来源及其本地文档？"
        okText="删除"
        cancelText="取消"
        onConfirm={() => remove.mutate(props.source.id)}
      >
        <Button
          danger
          type="text"
          size="small"
          loading={remove.isPending}
          onClick={(event) => event.stopPropagation()}
        >
          删除
        </Button>
      </Popconfirm>
    </div>
  )
}

const emptyForm: SourceFormValue = {
  name: '',
  url: '',
  mode: DOCUMENT_SOURCE_DEFAULTS.mode,
  pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
  scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath
}

function fromSource(source: DocumentSource): SourceFormValue {
  return {
    name: source.name,
    url: source.url,
    mode: source.mode,
    pageLimit: source.pageLimit,
    scopePath: source.scopePath,
    excludePathPattern: source.excludePathPattern ?? undefined,
    schedule: source.schedule ?? undefined,
    httpConcurrency: source.httpConcurrency ?? undefined,
    browserConcurrency: source.browserConcurrency ?? undefined,
    githubArchiveLimitMb: source.githubArchiveLimitMb ?? undefined,
    githubMarkdownLimitMb: source.githubMarkdownLimitMb ?? undefined
  }
}

function toInput(value: SourceFormValue): CreateSourceInput | UpdateSourceInput {
  return {
    name: value.name.trim(),
    url: value.url.trim(),
    mode: value.mode,
    pageLimit: value.pageLimit,
    scopePath: value.scopePath.trim() || '/',
    excludePathPattern: value.excludePathPattern?.trim() || null,
    schedule: value.schedule?.trim() || null,
    httpConcurrency: value.httpConcurrency ?? null,
    browserConcurrency: value.browserConcurrency ?? null,
    githubArchiveLimitMb: value.githubArchiveLimitMb ?? null,
    githubMarkdownLimitMb: value.githubMarkdownLimitMb ?? null
  }
}

function OptionalNumberField(props: {
  name: keyof SourceFormValue
  label: string
  size?: boolean
}): React.JSX.Element {
  const limits = props.size
    ? DOCUMENT_SOURCE_LIMITS.githubSizeMb
    : DOCUMENT_SOURCE_LIMITS.concurrency
  return (
    <Form.Item name={props.name} label={props.label}>
      <InputNumber {...limits} placeholder="继承全局设置" className="w-full" />
    </Form.Item>
  )
}
