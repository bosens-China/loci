import { useState } from 'react'
import { GithubOutlined, GlobalOutlined } from '@ant-design/icons'
import { Badge, Form, Modal, Segmented, Tabs } from 'antd'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  normalizeCronSchedule,
  parseGithubRepositoryUrl,
  type CloudLibrary,
  type CloudLibraryInput,
  type SourceKind
} from '@loci/shared'
import { LibraryAdvancedFields } from '@/components/library/LibraryAdvancedFields'
import {
  LibraryBasicFields,
  type LibraryCoreFormValue
} from '@/components/library/LibraryCoreFields'
import { getAdvancedSettingsSummary } from '@/components/library/library-form'

interface Props {
  editing: CloudLibrary | 'new' | null
  submitting: boolean
  onClose: () => void
  onSubmit: (input: CloudLibraryInput) => void
}

interface AdminLibraryFormValue extends LibraryCoreFormValue {
  kind: SourceKind
}

export function AdminLibraryModal(props: Props): React.JSX.Element {
  const [form] = Form.useForm<AdminLibraryFormValue>()
  const [activeTab, setActiveTab] = useState<string>('basic')
  const kind = Form.useWatch('kind', form) ?? 'web'
  const formValues = Form.useWatch([], form)

  const isEditing = props.editing !== null && props.editing !== 'new'
  const customSettingsCount = getAdvancedSettingsSummary(
    formValues ?? (isEditing ? props.editing : null)
  )

  const initializeForm = (): void => {
    if (!props.editing) return
    setActiveTab('basic')
    form.setFieldsValue(
      props.editing === 'new'
        ? {
            name: '',
            url: '',
            kind: 'web',
            scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath,
            pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
            schedule: undefined
          }
        : {
            ...props.editing,
            kind: parseGithubRepositoryUrl(props.editing.url) ? 'github' : 'web',
            schedule: props.editing.schedule ?? undefined
          }
    )
  }

  const submit = async (): Promise<void> => {
    let input: AdminLibraryFormValue
    try {
      input = await form.validateFields()
    } catch (err: unknown) {
      const errorInfo = err as { errorFields?: Array<{ name: (string | number)[] }> }
      if (errorInfo.errorFields?.length) {
        const hasAdvancedError = errorInfo.errorFields.some((f) =>
          ['pageLimit', 'schedule'].includes(String(f.name[0]))
        )
        setActiveTab(hasAdvancedError ? 'advanced' : 'basic')
      }
      return
    }

    props.onSubmit({
      name: input.name.trim(),
      url: input.url.trim(),
      scopePath: input.scopePath?.trim() || '/',
      pageLimit: input.pageLimit ?? DOCUMENT_SOURCE_DEFAULTS.pageLimit,
      schedule: normalizeCronSchedule(input.schedule)
    })
  }

  return (
    <Modal
      title={props.editing === 'new' ? '添加 Server 文档库' : '编辑 Server 文档库'}
      open={props.editing !== null}
      width={600}
      okText={props.editing === 'new' ? '创建并首次同步' : '保存修改'}
      cancelText="取消"
      confirmLoading={props.submitting}
      destroyOnHidden
      onCancel={props.onClose}
      onOk={() => void submit()}
      afterOpenChange={(open) => {
        if (open) initializeForm()
      }}
    >
      <Form<AdminLibraryFormValue>
        form={form}
        layout="vertical"
        className="pt-2"
        requiredMark="optional"
      >
        <Form.Item name="kind" label="来源类型" className="mb-4">
          <Segmented
            block
            options={[
              { value: 'web', icon: <GlobalOutlined />, label: '普通站点' },
              { value: 'github', icon: <GithubOutlined />, label: 'GitHub 仓库' }
            ]}
          />
        </Form.Item>
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
                  <LibraryAdvancedFields kind={kind} scheduleAndLimitsOnly />
                </div>
              )
            }
          ]}
        />
      </Form>
    </Modal>
  )
}
