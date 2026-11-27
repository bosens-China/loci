import { useState } from 'react'
import {
  DeleteOutlined,
  EditOutlined,
  MenuOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography
} from 'antd'
import type { DocumentSectionDetail, EditDocumentSectionInput } from '@loci/shared'
import { ApiError } from '@/api/client'
import { editDocumentSection, listDocumentSections } from '@/api/documents'
import {
  createSectionAddInput,
  createSectionDeleteInput,
  createSectionUpdateInput
} from './document-sections-form'

export interface DocumentSectionsModalProps {
  docId: string | null
  libraryId: string
  title: string
  open: boolean
  onClose: () => void
  onDocumentUpdated?: () => void
}

/** 文档小节 CRUD 管理弹窗：查看、新增、编辑与删除 Markdown 小节。 */
export function DocumentSectionsModal(props: DocumentSectionsModalProps): React.JSX.Element {
  const { docId, libraryId, title, open, onClose, onDocumentUpdated } = props
  const { message, modal } = App.useApp()
  const client = useQueryClient()

  const [editingSection, setEditingSection] = useState<DocumentSectionDetail | 'new' | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [form] = Form.useForm<{ heading: string; level: number; content: string }>()

  // 直接获取全量小节列表，每个小节包含纯正文 body 及 updatedAt 版本号
  const sectionsQuery = useQuery({
    queryKey: ['document-sections', docId],
    queryFn: () => (docId ? listDocumentSections(docId) : []),
    enabled: Boolean(docId && open)
  })

  const editMutation = useMutation({
    mutationFn: async (input: EditDocumentSectionInput) => {
      if (!docId) throw new Error('缺少文档 ID')
      return editDocumentSection(docId, input)
    },
    onSuccess: () => {
      void sectionsQuery.refetch()
      void client.invalidateQueries({ queryKey: ['library-file', libraryId, docId] })
      void client.invalidateQueries({ queryKey: ['document-detail', docId] })
      onDocumentUpdated?.()
      setEditingSection(null)
      void message.success('小节变更已保存')
    },
    onError: (error: Error) => {
      if (
        (error instanceof ApiError && error.status === 409) ||
        (error as { status?: number }).status === 409
      ) {
        void message.error('小节或文档已被其他进程修改，产生版本冲突。请刷新后重新编辑。')
        void sectionsQuery.refetch()
      } else {
        void message.error(error.message)
      }
    }
  })

  const handleOpenAdd = (): void => {
    setEditingSection('new')
    form.resetFields()
    form.setFieldsValue({ heading: '', level: 2, content: '' })
  }

  // 直接使用小节自身提供的纯正文 body，不经过 /api/read，防止截断且避免重复标题
  const handleOpenEdit = (section: DocumentSectionDetail): void => {
    setEditingSection(section)
    form.setFieldsValue({
      heading: section.title,
      level: section.level,
      content: section.body
    })
  }

  const handlePreview = (section: DocumentSectionDetail): void => {
    setPreviewContent(section.body)
  }

  const sections = sectionsQuery.data ?? []
  const isSaveDisabled = sectionsQuery.isLoading || sectionsQuery.isError

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      if (editingSection === 'new') {
        const latestUpdatedAt = sections[0]?.updatedAt
        editMutation.mutate(createSectionAddInput(values, latestUpdatedAt))
      } else if (editingSection) {
        const input = createSectionUpdateInput(editingSection, values)
        if (values.content !== editingSection.body) {
          modal.confirm({
            title: '替换小节正文？',
            content: editingSection.title,
            okText: '替换正文',
            cancelText: '取消',
            focusable: { autoFocusButton: 'cancel' },
            okButtonProps: { danger: true },
            onOk: () => editMutation.mutateAsync(input)
          })
        } else editMutation.mutate(input)
      }
    } catch {
      // 校验失败
    }
  }

  return (
    <Modal
      open={open}
      title={
        <div className="flex items-center gap-2">
          <MenuOutlined />
          <span>小节管理：{title}</span>
        </div>
      }
      width={720}
      footer={null}
      onCancel={() => {
        setEditingSection(null)
        setPreviewContent(null)
        onClose()
      }}
      destroyOnHidden
    >
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <Typography.Text type="secondary" className="text-xs">
            当前文档共 {sections.length} 个小节，支持独立读取、新增、修改与删除
          </Typography.Text>
          <Space>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => void sectionsQuery.refetch()}
            >
              刷新
            </Button>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleOpenAdd}>
              新增小节
            </Button>
          </Space>
        </div>

        {sectionsQuery.isError && (
          <Alert
            type="error"
            showIcon
            title="加载小节列表失败"
            description={sectionsQuery.error?.message}
            action={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void sectionsQuery.refetch()}
              >
                重试
              </Button>
            }
          />
        )}

        {/* 编辑/新增小节表单 */}
        {editingSection && (
          <Card
            size="small"
            title={editingSection === 'new' ? '新增小节' : `编辑小节: ${editingSection.title}`}
            extra={
              <Button type="text" size="small" onClick={() => setEditingSection(null)}>
                取消
              </Button>
            }
            className="border-[var(--ant-color-primary)] shadow-xs bg-[var(--ant-color-fill-quaternary)]"
          >
            <Form form={form} layout="vertical">
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <Form.Item
                  name="heading"
                  label="小节标题"
                  rules={[{ required: true, message: '请输入标题' }]}
                >
                  <Input placeholder="输入标题名称" />
                </Form.Item>
                <Form.Item name="level" label="层级">
                  <InputNumber min={1} max={6} className="w-full" />
                </Form.Item>
              </div>
              <Form.Item
                name="content"
                label="小节正文 (Markdown)"
                rules={[{ required: true, message: '请输入正文' }]}
              >
                <Input.TextArea
                  rows={6}
                  placeholder="输入小节 Markdown 正文（无需重复包含标题行）..."
                />
              </Form.Item>
              <div className="flex justify-end">
                <Button
                  type="primary"
                  loading={editMutation.isPending}
                  disabled={isSaveDisabled}
                  onClick={handleSave}
                >
                  保存小节
                </Button>
              </div>
            </Form>
          </Card>
        )}

        {/* 预览小节浮层 */}
        {previewContent !== null && (
          <Card
            size="small"
            title="小节纯正文预览"
            extra={
              <Button type="text" size="small" onClick={() => setPreviewContent(null)}>
                关闭预览
              </Button>
            }
            className="border-[var(--ant-color-border-secondary)] shadow-xs"
          >
            <pre className="max-h-48 overflow-y-auto font-mono text-xs whitespace-pre-wrap m-0">
              {previewContent || '*(正文为空)*'}
            </pre>
          </Card>
        )}

        {/* 小节列表 */}
        <List
          size="small"
          bordered
          loading={sectionsQuery.isLoading}
          dataSource={sections}
          locale={{ emptyText: <Empty description="当前文档未提取到子小节" /> }}
          renderItem={(section) => (
            <List.Item
              actions={[
                <Button key="view" type="link" size="small" onClick={() => handlePreview(section)}>
                  预览
                </Button>,
                <Button
                  key="edit"
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenEdit(section)}
                >
                  编辑
                </Button>,
                <Popconfirm
                  key="delete"
                  title="确认删除此小节？"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => editMutation.mutateAsync(createSectionDeleteInput(section))}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>
              ]}
            >
              <div className="flex items-center gap-2">
                <Tag variant="filled" color="blue" className="m-0! font-mono">
                  H{section.level}
                </Tag>
                <Typography.Text strong className="text-sm">
                  {section.title}
                </Typography.Text>
                <Typography.Text type="secondary" className="text-xs">
                  ({section.charCount} 字符)
                </Typography.Text>
              </div>
            </List.Item>
          )}
        />
      </div>
    </Modal>
  )
}
