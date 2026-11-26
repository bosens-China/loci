import { useState } from 'react'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag } from 'antd'
import type { HostnameCrawlPolicy, SaveHostnameCrawlPolicyInput } from '@loci/shared'
import { deleteHostnamePolicy, listHostnamePolicies, saveHostnamePolicy } from '@/api/settings'
import { formatDateTime } from '@/utils/format'

const QUERY_KEY = ['hostname-policies'] as const

/** 域名抓取策略管理面板：为特定域名定制并发与批次延迟限制。 */
export function HostnamePoliciesPanel(): React.JSX.Element {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<HostnameCrawlPolicy | null>(null)
  const [form] = Form.useForm<SaveHostnameCrawlPolicyInput>()

  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listHostnamePolicies })

  const saveMutation = useMutation({
    mutationFn: saveHostnamePolicy,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      void message.success('域名策略已保存')
      setModalOpen(false)
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const deleteMutation = useMutation({
    mutationFn: deleteHostnamePolicy,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      void message.success('域名策略已删除')
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const openAdd = (): void => {
    setEditingPolicy(null)
    form.resetFields()
    form.setFieldsValue({
      hostname: '',
      httpConcurrency: null,
      browserConcurrency: null,
      batchIntervalMinSeconds: null,
      batchIntervalMaxSeconds: null
    })
    setModalOpen(true)
  }

  const openEdit = (record: HostnameCrawlPolicy): void => {
    setEditingPolicy(record)
    form.setFieldsValue(record)
    setModalOpen(true)
  }

  const columns = [
    {
      title: '域名',
      dataIndex: 'hostname',
      key: 'hostname',
      render: (val: string) => (
        <Tag color="blue" className="font-mono">
          {val}
        </Tag>
      )
    },
    {
      title: 'HTTP 并发',
      dataIndex: 'httpConcurrency',
      key: 'httpConcurrency',
      render: (val: number | null) =>
        val !== null ? (
          `${val} 并发`
        ) : (
          <span className="text-[var(--ant-color-text-tertiary)]">默认</span>
        )
    },
    {
      title: '浏览器并发',
      dataIndex: 'browserConcurrency',
      key: 'browserConcurrency',
      render: (val: number | null) =>
        val !== null ? (
          `${val} 并发`
        ) : (
          <span className="text-[var(--ant-color-text-tertiary)]">默认</span>
        )
    },
    {
      title: '批次间隔 (秒)',
      key: 'batchInterval',
      render: (_: unknown, record: HostnameCrawlPolicy) => {
        if (record.batchIntervalMinSeconds === null && record.batchIntervalMaxSeconds === null) {
          return <span className="text-[var(--ant-color-text-tertiary)]">无间隔</span>
        }
        return `${record.batchIntervalMinSeconds ?? 0}s ~ ${record.batchIntervalMaxSeconds ?? 0}s`
      }
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (val: string) => formatDateTime(val)
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: HostnameCrawlPolicy) => (
        <Space size={8}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          />
          <Popconfirm
            title="删除域名策略？"
            description={`删除后 ${record.hostname} 将恢复为全局默认并发设置。`}
            onConfirm={() => deleteMutation.mutate(record.hostname)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-[var(--ant-color-text-secondary)]">
          为反爬严格或负载敏感的特定目标域名单独设置抓取速率与批次间隔。
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void query.refetch()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
            添加域名策略
          </Button>
        </Space>
      </div>

      <Table
        rowKey="hostname"
        columns={columns}
        dataSource={query.data ?? []}
        loading={query.isLoading}
        pagination={{ pageSize: 10 }}
        size="small"
      />

      <Modal
        open={modalOpen}
        title={editingPolicy ? `编辑策略: ${editingPolicy.hostname}` : '新增域名策略'}
        okText="保存策略"
        cancelText="取消"
        confirmLoading={saveMutation.isPending}
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          form.validateFields().then((values) => saveMutation.mutate(values))
        }}
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item
            name="hostname"
            label="域名 (Hostname)"
            rules={[
              { required: true, message: '请输入域名' },
              {
                pattern: /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/u,
                message: '请输入有效域名（如 docs.example.com，不包含协议或路径）'
              }
            ]}
          >
            <Input placeholder="docs.example.com" disabled={Boolean(editingPolicy)} />
          </Form.Item>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="httpConcurrency" label="HTTP 并发数（留空使用默认）">
              <InputNumber min={1} max={30} className="w-full" placeholder="默认" />
            </Form.Item>
            <Form.Item name="browserConcurrency" label="浏览器并发数（留空使用默认）">
              <InputNumber min={1} max={10} className="w-full" placeholder="默认" />
            </Form.Item>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="batchIntervalMinSeconds" label="最小批次间隔 (秒)">
              <InputNumber min={0} max={3600} className="w-full" placeholder="默认 0" />
            </Form.Item>
            <Form.Item name="batchIntervalMaxSeconds" label="最大批次间隔 (秒)">
              <InputNumber min={0} max={3600} className="w-full" placeholder="默认 0" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
