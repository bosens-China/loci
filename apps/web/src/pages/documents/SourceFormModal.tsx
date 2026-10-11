import { useState } from 'react'
import { SyncOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Badge, Button, Form, Modal, Popconfirm, Tabs } from 'antd'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  parseGithubRepositoryUrl,
  type CreateSourceResult,
  type DocumentSource
} from '@loci/shared'
import { enqueueSourceSync } from '@/api/jobs'
import { createSource, deleteSource, updateSource } from '@/api/sources'
import { LibraryAdvancedFields } from '@/components/library/LibraryAdvancedFields'
import { LibraryBasicFields } from '@/components/library/LibraryCoreFields'
import {
  getAdvancedSettingsSummary,
  getLocalLibraryRemovalWarning
} from '@/components/library/library-form'
import { toSourceInput, type SourceFormValue } from './source-form'

interface SourceFormModalProps {
  editing: DocumentSource | 'new' | null
  onClose: () => void
  onSaved: () => void
}

const ADVANCED_FIELD_NAMES = [
  'pageLimit',
  'schedule',
  'mode',
  'excludePathPattern',
  'githubArchiveLimitMb',
  'githubMarkdownLimitMb'
]

export function SourceFormModal(props: SourceFormModalProps): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<SourceFormValue>()
  const [activeTab, setActiveTab] = useState<string>('basic')
  const url = Form.useWatch('url', form) ?? ''
  const kind = parseGithubRepositoryUrl(url) ? 'github' : 'web'
  const formValues = Form.useWatch([], form)

  const isEditing = props.editing !== null && props.editing !== 'new'
  const customSettingsCount = getAdvancedSettingsSummary(
    formValues ?? (isEditing ? props.editing : null)
  )

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ['sources'] })
    void client.invalidateQueries({ queryKey: ['jobs'] })
  }

  const save = useMutation({
    mutationFn: async (value: SourceFormValue) => {
      const input = toSourceInput(value)
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
    let value: SourceFormValue
    try {
      value = await form.validateFields()
    } catch (err: unknown) {
      const errorInfo = err as { errorFields?: Array<{ name: (string | number)[] }> }
      if (errorInfo.errorFields?.length) {
        const hasAdvancedError = errorInfo.errorFields.some((f) =>
          ADVANCED_FIELD_NAMES.includes(String(f.name[0]))
        )
        setActiveTab(hasAdvancedError ? 'advanced' : 'basic')
      }
      return
    }

    const current = props.editing
    if (current !== 'new' && current) {
      const input = toSourceInput(value)
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
      title={props.editing === 'new' ? '添加文档库' : '编辑文档库'}
      open={props.editing !== null}
      width={600}
      centered
      classNames={{ body: 'max-h-[calc(100dvh-180px)] overflow-y-auto pr-1' }}
      okText={props.editing === 'new' ? '添加并同步' : '保存修改'}
      cancelText="取消"
      confirmLoading={save.isPending}
      onCancel={props.onClose}
      onOk={() => void submit()}
      destroyOnHidden
      afterOpenChange={(open) => {
        if (!open) return
        setActiveTab('basic')
        form.setFieldsValue(
          props.editing === 'new' || !props.editing ? createEmptyForm() : fromSource(props.editing)
        )
      }}
    >
      <Form form={form} layout="vertical" className="pt-2" requiredMark="optional">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'basic',
              label: '基础设置',
              children: (
                <div className="pt-1">
                  <LibraryBasicFields
                    autoFocusUrl
                    suggestName={props.editing === 'new'}
                    kind={kind}
                  />
                </div>
              )
            },
            {
              key: 'advanced',
              forceRender: true,
              label: (
                <span className="flex items-center gap-1.5">
                  高级设置
                  {customSettingsCount > 0 && (
                    <Badge
                      count={customSettingsCount}
                      size="small"
                      color="var(--ant-color-primary)"
                    />
                  )}
                </span>
              ),
              children: (
                <div className="pt-1">
                  <LibraryAdvancedFields kind={kind} />
                </div>
              )
            }
          ]}
        />
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
    return <span className="text-[11px] text-[var(--ant-color-text-secondary)]">只读快照</span>
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

function createEmptyForm(): SourceFormValue {
  return {
    name: '',
    url: '',
    kind: 'web',
    mode: DOCUMENT_SOURCE_DEFAULTS.mode,
    pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
    scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath
  }
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
    githubArchiveLimitMb: source.githubArchiveLimitMb ?? undefined,
    githubMarkdownLimitMb: source.githubMarkdownLimitMb ?? undefined
  }
}
