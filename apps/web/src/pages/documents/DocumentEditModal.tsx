import { useEffect } from 'react'
import { FileAddOutlined, FormOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Skeleton } from 'antd'
import type { CreateDocumentInput, DocumentDetail, DocumentRecord } from '@loci/shared'
import { ApiError } from '@/api/client'
import { createDocument, getDocument, updateDocument } from '@/api/documents'
import { calculateDocumentUpdate } from './document-edit-form'

export interface DocumentEditModalProps {
  libraryId: string
  editingDoc: DocumentRecord | 'new' | null
  onClose: () => void
  onSuccess: (savedDoc: DocumentRecord) => void
}

/** 新建文档或编辑整篇 Markdown 弹窗。加载完整原文，防截断并执行并发乐观锁。 */
export function DocumentEditModal(props: DocumentEditModalProps): React.JSX.Element {
  const { libraryId, editingDoc, onClose, onSuccess } = props
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<CreateDocumentInput>()

  const isEditing = editingDoc !== null && editingDoc !== 'new'
  const docId = isEditing ? editingDoc.id : null

  // 编辑现有文档时，通过 GET /api/documents/:docId 获取包含完整 content 和 updatedAt 的文档详情
  const docDetailQuery = useQuery({
    queryKey: ['document-detail', docId],
    queryFn: () => (docId ? getDocument(docId) : null),
    enabled: Boolean(isEditing && docId && editingDoc !== null)
  })

  const isLoadingDetail = isEditing && docDetailQuery.isLoading
  const isLoadDetailError = isEditing && docDetailQuery.isError
  const isSaveDisabled = isEditing && (isLoadingDetail || isLoadDetailError || !docDetailQuery.data)

  useEffect(() => {
    if (isEditing && docDetailQuery.data) {
      const detail = docDetailQuery.data
      form.setFieldsValue({
        title: detail.title,
        content: detail.content,
        language: detail.language || 'markdown'
      })
    } else if (editingDoc === 'new') {
      form.resetFields()
      form.setFieldsValue({
        title: '',
        path: '/manual/new-doc.md',
        content: '# 新建文档\n\n在此输入 Markdown 正文...',
        language: 'markdown'
      })
    }
  }, [editingDoc, isEditing, docDetailQuery.data, form])

  const saveMutation = useMutation({
    mutationFn: async ({
      values,
      detail
    }: {
      values: CreateDocumentInput
      detail: DocumentDetail | null
    }) => {
      if (detail) {
        const updateInput = calculateDocumentUpdate(detail, values)
        return updateDocument(detail.id, updateInput)
      }
      return createDocument(libraryId, {
        title: values.title.trim(),
        path: values.path?.trim() || undefined,
        content: values.content,
        language: values.language || 'markdown'
      })
    },
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: ['library-tree', libraryId] })
      void client.invalidateQueries({ queryKey: ['library-file', libraryId, saved.id] })
      void client.invalidateQueries({ queryKey: ['document-detail', saved.id] })
      void message.success(isEditing ? '文档已更新' : '文档已创建')
      onSuccess(saved)
      onClose()
    },
    onError: (error: Error) => {
      if (
        (error instanceof ApiError && error.status === 409) ||
        (error as { status?: number }).status === 409
      ) {
        void message.error('文档已被其他进程修改，产生版本冲突。请刷新后重新编辑。')
        void docDetailQuery.refetch()
      } else {
        void message.error(error.message)
      }
    }
  })

  const handleSave = async (): Promise<void> => {
    const values = await form.validateFields().catch(() => undefined)
    if (!values) return
    const detail = isEditing ? docDetailQuery.data : null
    if (isEditing && !detail) return
    const input = { values, detail: detail ?? null }
    if (detail && values.content !== detail.content) {
      modal.confirm({
        title: '替换文档正文？',
        content: detail.title,
        okText: '替换正文',
        cancelText: '取消',
        focusable: { autoFocusButton: 'cancel' },
        okButtonProps: { danger: true },
        onOk: () => saveMutation.mutateAsync(input)
      })
    } else saveMutation.mutate(input)
  }

  return (
    <Modal
      open={editingDoc !== null}
      title={
        <div className="flex items-center gap-2">
          {isEditing ? <FormOutlined /> : <FileAddOutlined />}
          <span>
            {isEditing ? `编辑文档：${(editingDoc as DocumentRecord).title}` : '新建文档'}
          </span>
        </div>
      }
      width={780}
      okText={isEditing ? '保存修改' : '创建文档'}
      cancelText="取消"
      confirmLoading={saveMutation.isPending}
      okButtonProps={{ disabled: isSaveDisabled }}
      onCancel={() => {
        form.resetFields()
        onClose()
      }}
      onOk={() => void handleSave()}
      destroyOnHidden
    >
      {isLoadingDetail && (
        <div className="py-6">
          <Skeleton active paragraph={{ rows: 10 }} />
        </div>
      )}

      {isLoadDetailError && (
        <div className="py-4">
          <Alert
            type="error"
            showIcon
            title="无法加载文档完整正文"
            description={docDetailQuery.error?.message || '读取完整内容失败'}
            action={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => void docDetailQuery.refetch()}
              >
                重试
              </Button>
            }
          />
        </div>
      )}

      {!isLoadingDetail && !isLoadDetailError && (
        <Form form={form} layout="vertical" className="pt-3">
          <Form.Item
            name="title"
            label="文档标题"
            rules={[{ required: true, message: '请输入文档标题' }]}
          >
            <Input placeholder="输入文档标题" />
          </Form.Item>

          {!isEditing && (
            <Form.Item
              name="path"
              label="逻辑相对路径 (Path)"
              rules={[{ required: true, message: '请输入相对路径' }]}
              extra="如 /guide/getting-started.md，将对应目录树层级"
            >
              <Input placeholder="/guide/intro.md" />
            </Form.Item>
          )}

          <Form.Item
            name="content"
            label="Markdown 正文"
            rules={[{ required: true, message: '请输入 Markdown 正文' }]}
          >
            <Input.TextArea
              rows={14}
              className="font-mono text-xs leading-relaxed"
              placeholder="# 标题&#10;&#10;正文内容..."
            />
          </Form.Item>
        </Form>
      )}
    </Modal>
  )
}
