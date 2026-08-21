import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Select } from 'antd'
import { SyncOutlined } from '@ant-design/icons'
import type { CreateSourceInput, DocumentSource, FetchMode, UpdateSourceInput } from '@loci/shared'
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
      const input = toInput(value, props.editing === 'new' ? null : props.editing)
      return props.editing === 'new' ? createSource(input) : updateSource(props.editing!.id, input)
    },
    onSuccess: (saved) => {
      props.onClose()
      refresh()
      props.onSaved()
      const newlyScheduled =
        Boolean(saved.schedule) &&
        (props.editing === 'new' || !props.editing || !props.editing.schedule)
      void message.success(
        newlyScheduled
          ? '文档来源已保存；结束当前 Loci UI 会话后，后台服务会自动接管定时更新'
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
        <Form.Item name="schedule" label="定时计划（可选）" extra="5 段 cron，例如 0 9 * * 1">
          <Input placeholder="0 9 * * 1" />
        </Form.Item>
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
