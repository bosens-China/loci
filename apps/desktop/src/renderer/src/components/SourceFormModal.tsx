import { LinkOutlined } from '@ant-design/icons'
import { Form, Input, InputNumber, Modal, Select, Tabs } from 'antd'
import type { FormInstance } from 'antd'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '@loci/core/source-policy'
import type { DocumentSource } from '../types'
import type { SourceFormValues } from './sourceScheduleForm'
import SourceScheduleFields from './SourceScheduleFields'
import { SourceScopeSelector } from './SourceScopeSelector'
import { deriveSourceName, getSourceScopeOptions, parseGithubRepositoryUrl } from './sourceFormUrl'

interface SourceFormModalProps {
  form: FormInstance<SourceFormValues>
  editingSource: DocumentSource | null
  open: boolean
  submitting: boolean
  onCancel: () => void
  onSubmit: (values: SourceFormValues) => void
}

export function SourceFormModal({
  form,
  editingSource,
  open,
  submitting,
  onCancel,
  onSubmit
}: SourceFormModalProps): React.JSX.Element {
  const url = Form.useWatch('url', form) ?? ''
  const repository = parseGithubRepositoryUrl(url)
  const applyUrlDefaults = (inputUrl = url): void => {
    const scopeOptions = getSourceScopeOptions(inputUrl)
    if (!scopeOptions.length) return
    const scopePath = form.getFieldValue('scopePath')
    const currentName = form.getFieldValue('name')?.trim() ?? ''
    const values: Partial<SourceFormValues> = {}
    if (parseGithubRepositoryUrl(inputUrl)) {
      values.scopePath = DOCUMENT_SOURCE_DEFAULTS.scopePath
      values.mode = DOCUMENT_SOURCE_DEFAULTS.mode
    } else if (!scopeOptions.some((option) => option.value === scopePath)) {
      values.scopePath = DOCUMENT_SOURCE_DEFAULTS.scopePath
    }
    if (!editingSource && (!currentName || !form.isFieldTouched('name'))) {
      values.name = parseGithubRepositoryUrl(inputUrl)?.repo ?? deriveSourceName(inputUrl)
    }
    form.setFieldsValue(values)
  }

  return (
    <Modal
      title={editingSource ? '编辑文档源' : '添加文档源'}
      open={open}
      width={580}
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={() => form.submit()}
      okText={editingSource ? '保存修改' : '添加文档源'}
      cancelText="取消"
    >
      <Form form={form} layout="vertical" onFinish={onSubmit} className="mt-4!">
        <Tabs
          defaultActiveKey="basic"
          items={[
            {
              key: 'basic',
              label: '基础配置',
              children: (
                <div className="space-y-3 pt-2">
                  <Form.Item
                    name="url"
                    label={repository ? 'GitHub 仓库 URL' : '起始页面 URL'}
                    extra={
                      repository
                        ? '将读取公开仓库默认分支中的 Markdown，不需要选择分支'
                        : '请输入文档站点的首页或任意起始阅读页面 URL'
                    }
                    rules={[
                      { required: true, message: '请输入公开文档页面 URL' },
                      { type: 'url', message: '请输入有效 URL 地址' }
                    ]}
                  >
                    <Input
                      prefix={<LinkOutlined />}
                      placeholder="https://example.com/docs/start"
                      onChange={(event) => applyUrlDefaults(event.currentTarget.value)}
                      onBlur={(event) => applyUrlDefaults(event.currentTarget.value)}
                    />
                  </Form.Item>
                  <Form.Item
                    name="name"
                    label="文档源名称"
                    rules={[
                      { required: true, message: '请输入文档源名称' },
                      {
                        max: DOCUMENT_SOURCE_LIMITS.nameLength.max,
                        message: `最多 ${DOCUMENT_SOURCE_LIMITS.nameLength.max} 个字符`
                      }
                    ]}
                  >
                    <Input
                      maxLength={DOCUMENT_SOURCE_LIMITS.nameLength.max}
                      placeholder="例如：rspress"
                    />
                  </Form.Item>
                  {!repository && (
                    <Form.Item
                      name="scopePath"
                      label="收录范围"
                      extra="拖动或点击路径节点，只收录所选路径及其子路径"
                      rules={[{ required: true, message: '请选择收录范围' }]}
                    >
                      <SourceScopeSelector url={url} />
                    </Form.Item>
                  )}
                  <Form.Item
                    name="pageLimit"
                    label={repository ? '收录 Markdown 上限' : '收录页面上限'}
                    extra={
                      repository
                        ? '按仓库 ZIP 中的文件顺序收录，达到数量后不再保存更多 Markdown'
                        : '达到设定的页面上限后将自动停止，防止无限制抓取'
                    }
                    rules={[{ required: true, message: '请输入页面上限' }]}
                  >
                    <InputNumber
                      min={DOCUMENT_SOURCE_LIMITS.pageLimit.min}
                      max={DOCUMENT_SOURCE_LIMITS.pageLimit.max}
                      className="w-full"
                      addonAfter={repository ? '个' : '页'}
                    />
                  </Form.Item>
                </div>
              )
            },
            {
              key: 'schedule',
              label: '自动更新',
              children: <SourceScheduleFields form={form} />
            },
            {
              key: 'advanced',
              label: '高级设置',
              forceRender: true,
              children: (
                <div className="space-y-3 pt-2">
                  {repository ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Form.Item
                        name="githubArchiveLimitMb"
                        label="ZIP 下载上限（选填）"
                        extra="留空时使用全局默认值"
                        rules={[
                          {
                            type: 'number',
                            min: DOCUMENT_SOURCE_LIMITS.githubSizeMb.min,
                            max: DOCUMENT_SOURCE_LIMITS.githubSizeMb.max
                          }
                        ]}
                      >
                        <InputNumber
                          min={DOCUMENT_SOURCE_LIMITS.githubSizeMb.min}
                          max={DOCUMENT_SOURCE_LIMITS.githubSizeMb.max}
                          className="w-full"
                          placeholder="全局默认"
                          addonAfter="MB"
                        />
                      </Form.Item>
                      <Form.Item
                        name="githubMarkdownLimitMb"
                        label="Markdown 总量上限（选填）"
                        extra="留空时使用全局默认值"
                        rules={[
                          {
                            type: 'number',
                            min: DOCUMENT_SOURCE_LIMITS.githubSizeMb.min,
                            max: DOCUMENT_SOURCE_LIMITS.githubSizeMb.max
                          }
                        ]}
                      >
                        <InputNumber
                          min={DOCUMENT_SOURCE_LIMITS.githubSizeMb.min}
                          max={DOCUMENT_SOURCE_LIMITS.githubSizeMb.max}
                          className="w-full"
                          placeholder="全局默认"
                          addonAfter="MB"
                        />
                      </Form.Item>
                    </div>
                  ) : (
                    <>
                      <Form.Item name="mode" label="网页读取方式" rules={[{ required: true }]}>
                        <Select
                          options={[
                            { value: 'auto', label: '自动检测（推荐 · 识别最佳速度）' },
                            { value: 'http', label: 'HTTP 直取（适用于普通静态网页）' },
                            { value: 'browser', label: '浏览器渲染（适用于动态渲染网页）' }
                          ]}
                        />
                      </Form.Item>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Form.Item
                          name="httpConcurrency"
                          label="HTTP 并发抓取数（选填）"
                          extra="留空时使用全局 HTTP 默认值"
                          rules={[
                            {
                              type: 'number',
                              min: DOCUMENT_SOURCE_LIMITS.concurrency.min,
                              max: DOCUMENT_SOURCE_LIMITS.concurrency.max,
                              message: `请输入 ${DOCUMENT_SOURCE_LIMITS.concurrency.min}-${DOCUMENT_SOURCE_LIMITS.concurrency.max}`
                            }
                          ]}
                        >
                          <InputNumber
                            min={DOCUMENT_SOURCE_LIMITS.concurrency.min}
                            max={DOCUMENT_SOURCE_LIMITS.concurrency.max}
                            className="w-full"
                            placeholder="全局默认"
                          />
                        </Form.Item>
                        <Form.Item
                          name="browserConcurrency"
                          label="浏览器并发抓取数（选填）"
                          extra="留空时使用全局浏览器默认值"
                          rules={[
                            {
                              type: 'number',
                              min: DOCUMENT_SOURCE_LIMITS.concurrency.min,
                              max: DOCUMENT_SOURCE_LIMITS.concurrency.max,
                              message: `请输入 ${DOCUMENT_SOURCE_LIMITS.concurrency.min}-${DOCUMENT_SOURCE_LIMITS.concurrency.max}`
                            }
                          ]}
                        >
                          <InputNumber
                            min={DOCUMENT_SOURCE_LIMITS.concurrency.min}
                            max={DOCUMENT_SOURCE_LIMITS.concurrency.max}
                            className="w-full"
                            placeholder="全局默认"
                          />
                        </Form.Item>
                      </div>
                    </>
                  )}
                </div>
              )
            }
          ]}
        />
      </Form>
    </Modal>
  )
}
