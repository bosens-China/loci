import { useState } from 'react'
import {
  CompassOutlined,
  DownOutlined,
  GithubOutlined,
  GlobalOutlined,
  RightOutlined
} from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Tag
} from 'antd'
import {
  parseGithubRepositoryUrl,
  type CategorySummary,
  type CreateSourceInput,
  type DocumentSource,
  type LibrarySummary,
  type SourceInspection
} from '@loci/shared'
import {
  createLibrary,
  fetchLibraryPages,
  inspectSource,
  syncLibrary,
  updateLibrary
} from '@/api/libraries'
import { getLocalLibraryRemovalWarning } from '@/components/library/library-form'
import { inferDefaultName, toSourceInput, type SourceFormValue } from './source-form'

interface SourceFormModalProps {
  editing: LibrarySummary | DocumentSource | 'new' | null
  categories: CategorySummary[]
  onClose: () => void
  onSaved: () => void
}

/** 新增与编辑文档库弹窗：支持输入 URL 无感直抓、预先探测规模、展开高级设置及精确页面抓取。 */
export function SourceFormModal(props: SourceFormModalProps): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<SourceFormValue & { explicitUrlsText?: string }>()
  const [inspection, setInspection] = useState<SourceInspection | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [crawlMode, setCrawlMode] = useState<'all' | 'explicit'>('all')

  const url = Form.useWatch('url', form) ?? ''
  const current = typeof props.editing === 'object' ? props.editing : null
  const isEditing = current !== null
  const isGithub = Boolean(parseGithubRepositoryUrl(url))

  // 探测来源规模
  const inspect = useMutation({
    mutationFn: inspectSource,
    onSuccess: (data: SourceInspection) => {
      setInspection(data)
      const pageText =
        data.estimatedPages !== null ? `约 ${data.estimatedPages} 页` : `${data.discoveredPages} 页`
      void message.success(`探测完成：预估 ${pageText}（发现策略: ${data.discovery}）`)
    },
    onError: (error: Error) => void message.error(`探测失败: ${error.message}`)
  })

  // 保存与抓取操作
  const save = useMutation({
    mutationFn: async (values: SourceFormValue & { explicitUrlsText?: string }) => {
      const input = toSourceInput(values)
      if (current) return updateLibrary(current.id, input)

      // 新增库
      const created = await createLibrary(input as CreateSourceInput)

      // 如果提供了精确页面列表
      if (crawlMode === 'explicit' && values.explicitUrlsText?.trim()) {
        const urls = values.explicitUrlsText
          .split('\n')
          .map((u) => u.trim())
          .filter(Boolean)
        if (urls.length > 0) {
          await fetchLibraryPages(created.id, urls)
          return created
        }
      }

      // 默认全量抓取
      await syncLibrary(created.id)
      return created
    },
    onSuccess: () => {
      props.onClose()
      void client.invalidateQueries({ queryKey: ['categories'] })
      void client.invalidateQueries({ queryKey: ['libraries'] })
      void client.invalidateQueries({ queryKey: ['library-crawl-statuses'] })
      props.onSaved()
      void message.success(isEditing ? '文档库配置已更新' : '已创建文档库并开始抓取')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const handleInspect = async (): Promise<void> => {
    try {
      const valid = await form.validateFields(['url'])
      const currentValues = form.getFieldsValue()
      inspect.mutate({
        url: valid.url.trim(),
        scopePath: currentValues.scopePath?.trim() || undefined,
        excludePathPattern: currentValues.excludePathPattern?.trim() || null
      })
    } catch {
      void message.warning('请先输入有效的起始 URL')
    }
  }

  const handleSubmit = async (): Promise<void> => {
    let values: SourceFormValue & { explicitUrlsText?: string }
    try {
      await form.validateFields()
      // 保留折叠面板内的旧配置和已经输入的值，单独修改标签不会改变抓取范围。
      values = form.getFieldsValue(true)
    } catch {
      return
    }

    if (current) {
      const input = toSourceInput(values)
      const warning = getLocalLibraryRemovalWarning(current, {
        kind: input.kind ?? current.kind,
        url: input.url,
        scopePath: input.scopePath ?? current.scopePath,
        excludePathPattern: input.excludePathPattern
      })
      if (warning) {
        modal.confirm({
          title: '保存并立即清理范围外的旧文档？',
          content: warning,
          okText: '确认更新',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => save.mutateAsync(values)
        })
        return
      }
    }

    save.mutate(values)
  }

  // 弹窗打开初始化默认值
  const initialValues: Partial<SourceFormValue> = current ?? {
    mode: 'auto',
    pageLimit: 1000,
    scopePath: '/'
  }

  return (
    <Modal
      open={props.editing !== null}
      title={current ? `编辑文档库：${current.name}` : '添加并抓取文档库'}
      width={600}
      okText={isEditing ? '保存修改' : '立即抓取'}
      cancelText="取消"
      confirmLoading={save.isPending}
      onCancel={props.onClose}
      onOk={handleSubmit}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onValuesChange={(changed) => {
          if (changed.url && !isEditing && !form.isFieldTouched('name')) {
            form.setFieldValue('name', inferDefaultName(changed.url))
          }
        }}
        className="pt-3"
      >
        <Form.Item
          name="url"
          label={
            <div className="flex items-center justify-between w-full">
              <span>{isGithub ? 'GitHub 仓库地址' : '文档站点 URL'}</span>
              {!isEditing && (
                <Button
                  type="link"
                  size="small"
                  icon={<CompassOutlined />}
                  loading={inspect.isPending}
                  onClick={handleInspect}
                  className="p-0! h-auto text-xs"
                >
                  探测规模
                </Button>
              )}
            </div>
          }
          rules={[
            { required: true, message: '请输入目标 URL' },
            { type: 'url', message: '请输入合法的 HTTP 或 HTTPS 地址' }
          ]}
          extra={
            isGithub
              ? '支持任意公开 GitHub 仓库，自动同步 Markdown 文档。'
              : '输入文档站点首页或子目录，自动识别 llms.txt、OpenAPI 或 HTML。'
          }
        >
          <Input
            prefix={isGithub ? <GithubOutlined /> : <GlobalOutlined />}
            placeholder={isGithub ? 'https://github.com/vuejs/core' : 'https://react.dev'}
            disabled={isEditing}
          />
        </Form.Item>

        {inspection && (
          <Alert
            type="info"
            showIcon
            className="mb-4 text-xs"
            message={`探测策略: ${inspection.discovery} · 预估页面数: ${inspection.estimatedPages !== null ? `~${inspection.estimatedPages}` : inspection.discoveredPages}`}
            description={
              inspection.pathGroups?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {inspection.pathGroups.slice(0, 4).map((g) => (
                    <Tag key={g.path} className="text-[10px]">
                      {g.path} ({g.pages}页)
                    </Tag>
                  ))}
                </div>
              ) : undefined
            }
          />
        )}

        <Form.Item
          name="name"
          label="文档库名称"
          rules={[{ required: true, message: '请输入文档库名称' }]}
        >
          <Input placeholder="例如：React 官方文档" />
        </Form.Item>

        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="category" label="分类">
            <AutoComplete
              allowClear
              placeholder="默认未分类，可输入新分类"
              options={props.categories.map(({ name }) => ({ value: name }))}
            />
          </Form.Item>
          <Form.Item name="version" label="版本">
            <Input allowClear placeholder="默认 latest，例如 v18" />
          </Form.Item>
        </div>

        {!isEditing && (
          <div className="mb-4">
            <Radio.Group
              value={crawlMode}
              onChange={(e) => setCrawlMode(e.target.value)}
              size="small"
              className="mb-2"
            >
              <Radio.Button value="all">整站/子树抓取</Radio.Button>
              <Radio.Button value="explicit">精确指定页面</Radio.Button>
            </Radio.Group>

            {crawlMode === 'explicit' && (
              <Form.Item
                name="explicitUrlsText"
                label="指定页面 URL 列表（每行一个）"
                rules={[{ required: true, message: '请输入至少一个页面 URL' }]}
                className="mb-0"
              >
                <Input.TextArea
                  rows={3}
                  placeholder="https://example.com/docs/intro&#10;https://example.com/docs/api"
                />
              </Form.Item>
            )}
          </div>
        )}

        {/* 高级配置折叠面板 */}
        <div className="border-t border-[var(--ant-color-split)] pt-3">
          <Button
            type="text"
            size="small"
            icon={showAdvanced ? <DownOutlined /> : <RightOutlined />}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="p-0! text-xs text-[var(--ant-color-text-secondary)] mb-3"
          >
            {showAdvanced ? '收起抓取高级配置' : '展开抓取高级配置（收录范围、排除正则、模式等）'}
          </Button>

          {showAdvanced && (
            <div className="space-y-3 rounded-lg bg-[var(--ant-color-fill-quaternary)] p-3">
              <div className="grid grid-cols-2 gap-3">
                <Form.Item name="scopePath" label="限定路径前缀" className="mb-0">
                  <Input placeholder="/" disabled={isGithub} />
                </Form.Item>
                <Form.Item name="pageLimit" label="最大收录页数" className="mb-0">
                  <InputNumber min={1} max={5000} className="w-full" placeholder="1000" />
                </Form.Item>
              </div>

              {!isGithub && (
                <div className="grid grid-cols-2 gap-3">
                  <Form.Item name="mode" label="抓取模式" className="mb-0">
                    <Select
                      options={[
                        { label: '自动推断 (推荐)', value: 'auto' },
                        { label: '纯 HTTP 快速抓取', value: 'http' },
                        { label: '无头浏览器渲染 (SPA/JS)', value: 'browser' }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="excludePathPattern" label="排除路径正则" className="mb-0">
                    <Input placeholder="^/(blog|v1)/" />
                  </Form.Item>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Form.Item name="httpConcurrency" label="HTTP 并发数" className="mb-0">
                  <InputNumber min={1} max={30} className="w-full" placeholder="全局默认" />
                </Form.Item>
                <Form.Item name="browserConcurrency" label="浏览器并发数" className="mb-0">
                  <InputNumber min={1} max={10} className="w-full" placeholder="全局默认" />
                </Form.Item>
              </div>
            </div>
          )}
        </div>
      </Form>
    </Modal>
  )
}
