import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  normalizeCronSchedule,
  type CreateSourceInput,
  type CreateSourceResult,
  type DocumentSource,
  type FetchMode,
  type SourceKind,
  type UpdateSourceInput
} from '@loci/shared'
import { enqueueSourceSync } from '@/api/jobs'
import { createSource, deleteSource, updateSource } from '@/api/sources'
import {
  LibraryCoreFields,
  type LibraryCoreFormValue
} from '@/components/library/LibraryCoreFields'
import { getLocalLibraryRemovalWarning } from '@/components/library/library-form'

interface SourceFormValue extends LibraryCoreFormValue {
  kind: SourceKind
  mode: FetchMode
  excludePathPattern?: string
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
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<SourceFormValue>()
  const kind = Form.useWatch('kind', form) ?? 'web'
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
  const submit = async (): Promise<void> => {
    const value = await form.validateFields()
    const current = props.editing
    if (current !== 'new' && current) {
      const input = toInput(value)
      const warning = getLocalLibraryRemovalWarning(current, {
        kind: input.kind ?? current.kind,
        url: input.url,
        scopePath: input.scopePath ?? current.scopePath,
        excludePathPattern: input.excludePathPattern
      })
      if (warning) {
        modal.confirm({
          title: '保存并立即删除不匹配的文档？',
          content: warning,
          okText: '删除并保存',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => save.mutateAsync(value)
        })
        return
      }
    }
    save.mutate(value)
  }

  return (
    <Modal
      title={props.editing === 'new' ? '添加文档来源' : '编辑文档来源'}
      open={props.editing !== null}
      okText="保存"
      cancelText="取消"
      confirmLoading={save.isPending}
      onCancel={props.onClose}
      onOk={() => void submit()}
      destroyOnHidden
      afterOpenChange={(open) => {
        if (!open) return
        form.setFieldsValue(
          props.editing === 'new' || !props.editing ? emptyForm : fromSource(props.editing)
        )
      }}
    >
      <Form form={form} layout="vertical" className="pt-2" requiredMark="optional">
        <Form.Item name="kind" label="来源类型">
          <Segmented
            block
            options={[
              { value: 'web', label: '普通站点' },
              { value: 'github', label: 'GitHub 仓库' }
            ]}
          />
        </Form.Item>
        <LibraryCoreFields autoFocusUrl suggestName={props.editing === 'new'} kind={kind} />
        {kind === 'web' ? (
          <>
            <Form.Item
              name="mode"
              label="页面获取方式"
              extra="普通站点会先自动检查 llms.txt 和 OpenAPI；这里只控制网页使用 HTTP 还是浏览器读取。"
            >
              <Select
                options={[
                  { value: 'auto', label: '自动检测' },
                  { value: 'http', label: 'HTTP' },
                  { value: 'browser', label: '浏览器' }
                ]}
              />
            </Form.Item>
            <Form.Item
              name="excludePathPattern"
              label="排除路径正则（可选）"
              extra="新增或修改后，保存会立即删除匹配页面的正文和搜索索引。"
              rules={[
                {
                  max: DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max,
                  message: '正则过长'
                }
              ]}
            >
              <Input placeholder="^/(zh|de|fr)(?:/|$)" />
            </Form.Item>
            <div className="grid grid-cols-2 gap-3">
              <OptionalNumberField name="httpConcurrency" label="HTTP 并发覆盖" />
              <OptionalNumberField name="browserConcurrency" label="浏览器并发覆盖" />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <OptionalNumberField name="githubArchiveLimitMb" label="GitHub ZIP 上限（MB）" size />
            <OptionalNumberField
              name="githubMarkdownLimitMb"
              label="GitHub Markdown 上限（MB）"
              size
            />
          </div>
        )}
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
    return <span className="text-[11px] text-muted">只读快照</span>
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
  kind: 'web',
  mode: DOCUMENT_SOURCE_DEFAULTS.mode,
  pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
  scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath
}

function fromSource(source: DocumentSource): SourceFormValue {
  return {
    name: source.name,
    url: source.url,
    kind: source.kind,
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
  const github = value.kind === 'github'
  return {
    name: value.name.trim(),
    url: value.url.trim(),
    kind: value.kind,
    mode: github ? DOCUMENT_SOURCE_DEFAULTS.mode : value.mode,
    pageLimit: value.pageLimit,
    scopePath: github ? DOCUMENT_SOURCE_DEFAULTS.scopePath : value.scopePath.trim() || '/',
    excludePathPattern: github ? null : value.excludePathPattern?.trim() || null,
    schedule: normalizeCronSchedule(value.schedule),
    httpConcurrency: github ? null : (value.httpConcurrency ?? null),
    browserConcurrency: github ? null : (value.browserConcurrency ?? null),
    githubArchiveLimitMb: github ? (value.githubArchiveLimitMb ?? null) : null,
    githubMarkdownLimitMb: github ? (value.githubMarkdownLimitMb ?? null) : null
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
