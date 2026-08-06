import { ClockCircleOutlined, LinkOutlined } from '@ant-design/icons'
import { AutoComplete, Form, Input, InputNumber, Modal } from 'antd'
import { useEffect } from 'react'
import type { CloudLibrary, CloudLibraryInput } from '@loci/shared'
import { SCHEDULE_PRESETS, getSourceScopeOptions, normalizeCronSchedule } from '@loci/shared'
import { SourceScopeSelector } from './SourceScopeSelector'

interface CloudLibraryFormValues {
  name: string
  url: string
  scopePath: string
  pageLimit: number
  schedule?: string
}

interface CloudLibraryFormModalProps {
  open: boolean
  library: CloudLibrary | null
  submitting: boolean
  onCancel: () => void
  onSubmit: (input: CloudLibraryInput) => void
}

function CloudLibraryFormModal({
  open,
  library,
  submitting,
  onCancel,
  onSubmit
}: CloudLibraryFormModalProps): React.JSX.Element {
  const [form] = Form.useForm<CloudLibraryFormValues>()
  const url = Form.useWatch('url', form) ?? ''

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      name: library?.name ?? '',
      url: library?.url ?? '',
      scopePath: library?.scopePath ?? '/',
      pageLimit: library?.pageLimit ?? 1000,
      schedule: library?.schedule ?? undefined
    })
  }, [form, library, open])

  const handleFinish = (values: CloudLibraryFormValues): void => {
    onSubmit({
      name: values.name.trim(),
      url: values.url.trim(),
      scopePath: values.scopePath,
      pageLimit: values.pageLimit,
      schedule: normalizeCronSchedule(values.schedule?.trim() || null)
    })
  }

  return (
    <Modal
      title={library ? '编辑云文档源' : '添加云文档源'}
      open={open}
      width={560}
      confirmLoading={submitting}
      okText={library ? '保存修改' : '添加并发布'}
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" className="mt-5!" onFinish={handleFinish}>
        <Form.Item
          name="name"
          label="文档源名称"
          rules={[{ required: true, message: '请输入文档源名称' }]}
        >
          <Input placeholder="例如：Hono 官方文档" />
        </Form.Item>
        <Form.Item
          name="url"
          label="起始页面 URL"
          rules={[
            { required: true, message: '请输入公开文档页面 URL' },
            { type: 'url', message: '请输入有效 URL 地址' }
          ]}
        >
          <Input
            prefix={<LinkOutlined />}
            placeholder="https://hono.dev/docs/"
            onBlur={(event) => {
              const options = getSourceScopeOptions(event.currentTarget.value)
              const scopePath = form.getFieldValue('scopePath')
              if (!options.some((option) => option.value === scopePath)) {
                form.setFieldValue('scopePath', '/')
              }
            }}
          />
        </Form.Item>
        <Form.Item
          name="scopePath"
          label="收录范围"
          extra="只收录所选路径及其子路径。"
          rules={[{ required: true, message: '请选择收录范围' }]}
        >
          <SourceScopeSelector url={url} />
        </Form.Item>
        <Form.Item
          name="pageLimit"
          label="收录页面上限"
          rules={[{ required: true, message: '请输入页面上限' }]}
        >
          <InputNumber min={1} max={10000} addonAfter="页" className="w-full" />
        </Form.Item>
        <Form.Item
          name="schedule"
          label="自动更新计划"
          extra="留空表示只允许手动同步；也可以直接输入标准 Cron 表达式。"
          rules={[
            {
              validator: (_, value?: string) => {
                try {
                  normalizeCronSchedule(value || null)
                  return Promise.resolve()
                } catch (error) {
                  return Promise.reject(error)
                }
              }
            }
          ]}
        >
          <AutoComplete
            allowClear
            options={SCHEDULE_PRESETS.map((item) => ({
              value: item.expression,
              label: `${item.label} · ${item.description}`
            }))}
          >
            <Input prefix={<ClockCircleOutlined />} placeholder="例如：0 2 * * *" />
          </AutoComplete>
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default CloudLibraryFormModal
