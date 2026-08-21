import { useEffect } from 'react'
import { Form, Modal } from 'antd'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  normalizeCronSchedule,
  type CloudLibrary,
  type CloudLibraryInput
} from '@loci/shared'
import {
  LibraryCoreFields,
  type LibraryCoreFormValue
} from '@/components/library/LibraryCoreFields'

interface Props {
  editing: CloudLibrary | 'new' | null
  submitting: boolean
  onClose: () => void
  onSubmit: (input: CloudLibraryInput) => void
}

export function AdminLibraryModal(props: Props): React.JSX.Element {
  const [form] = Form.useForm<LibraryCoreFormValue>()
  useEffect(() => {
    if (!props.editing) return
    form.setFieldsValue(
      props.editing === 'new'
        ? {
            name: '',
            url: '',
            scopePath: DOCUMENT_SOURCE_DEFAULTS.scopePath,
            pageLimit: DOCUMENT_SOURCE_DEFAULTS.pageLimit,
            schedule: undefined
          }
        : { ...props.editing, schedule: props.editing.schedule ?? undefined }
    )
  }, [form, props.editing])

  const submit = async (): Promise<void> => {
    const input = await form.validateFields()
    props.onSubmit({
      ...input,
      name: input.name.trim(),
      url: input.url.trim(),
      scopePath: input.scopePath.trim(),
      schedule: normalizeCronSchedule(input.schedule)
    })
  }

  return (
    <Modal
      title={props.editing === 'new' ? '添加 Server 文档库' : '编辑 Server 文档库'}
      open={props.editing !== null}
      width={600}
      okText={props.editing === 'new' ? '添加并发布' : '保存修改'}
      cancelText="取消"
      confirmLoading={props.submitting}
      destroyOnHidden
      onCancel={props.onClose}
      onOk={() => void submit()}
    >
      <Form form={form} layout="vertical" className="pt-2" requiredMark="optional">
        <LibraryCoreFields autoFocusUrl suggestName={props.editing === 'new'} />
      </Form>
    </Modal>
  )
}
