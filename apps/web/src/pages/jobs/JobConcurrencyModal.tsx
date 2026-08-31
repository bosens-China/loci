import { useEffect, useMemo, useState } from 'react'
import { CheckOutlined, GlobalOutlined, ThunderboltOutlined } from '@ant-design/icons'
import {
  APP_SETTINGS_LIMITS,
  isValidBatchIntervalRange,
  isValidBatchIntervalSeconds,
  type HostnameCrawlPolicy,
  type SaveHostnameCrawlPolicyInput
} from '@loci/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Form,
  InputNumber,
  Modal,
  Space,
  Tabs,
  Typography
} from 'antd'
import { getSettings, listHostnameCrawlPolicies, saveHostnameCrawlPolicy } from '@/api/settings'

export const POLICY_QUERY_KEY = ['settings', 'hostname-policies'] as const
export const SETTINGS_QUERY_KEY = ['settings'] as const

interface JobConcurrencyModalProps {
  open: boolean
  hostname?: string
  availableHostnames?: string[]
  initialMode?: 'http' | 'browser'
  onClose: () => void
  onSuccess?: (policy: HostnameCrawlPolicy) => void
}

interface ConcurrencyFormValues {
  hostname?: string
  httpConcurrency?: number | null
  browserConcurrency?: number | null
  batchIntervalMinSeconds?: number | null
  batchIntervalMaxSeconds?: number | null
}

/** 域名抓取并发与限速独立调节 Modal 弹窗（支持单域名调速与新建域名限制） */
export function JobConcurrencyModal(props: JobConcurrencyModalProps): React.JSX.Element {
  const {
    open,
    hostname: fixedHostname,
    availableHostnames = [],
    initialMode = 'http',
    onClose
  } = props
  const { message } = App.useApp()
  const client = useQueryClient()
  const [form] = Form.useForm<ConcurrencyFormValues>()
  const [activeTab, setActiveTab] = useState<'http' | 'browser'>(initialMode)
  const [selectedHostname, setSelectedHostname] = useState<string>(fixedHostname ?? '')

  const currentHostname = fixedHostname || selectedHostname

  const policies = useQuery({
    queryKey: POLICY_QUERY_KEY,
    queryFn: listHostnameCrawlPolicies
  })

  const globalSettings = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getSettings
  })

  const currentPolicy = policies.data?.find((item) => item.hostname === currentHostname)
  const defaultHttp = globalSettings.data?.httpConcurrency ?? 9
  const defaultBrowser = globalSettings.data?.browserConcurrency ?? 5

  useEffect(() => {
    if (!open || !fixedHostname || !policies.data) return
    form.setFieldsValue({
      hostname: fixedHostname,
      httpConcurrency: currentPolicy?.httpConcurrency ?? null,
      browserConcurrency: currentPolicy?.browserConcurrency ?? null,
      batchIntervalMinSeconds: currentPolicy?.batchIntervalMinSeconds ?? null,
      batchIntervalMaxSeconds: currentPolicy?.batchIntervalMaxSeconds ?? null
    })
  }, [currentPolicy, fixedHostname, form, open, policies.data])

  // 当选择不同域名时同步表单值
  const handleHostnameChange = (newHost: string): void => {
    setSelectedHostname(newHost)
    const target = policies.data?.find((item) => item.hostname === newHost)
    form.setFieldsValue({
      httpConcurrency: target?.httpConcurrency ?? null,
      browserConcurrency: target?.browserConcurrency ?? null,
      batchIntervalMinSeconds: target?.batchIntervalMinSeconds ?? null,
      batchIntervalMaxSeconds: target?.batchIntervalMaxSeconds ?? null
    })
  }

  const save = useMutation({
    mutationFn: saveHostnameCrawlPolicy,
    onSuccess: (updated) => {
      client.setQueryData<HostnameCrawlPolicy[]>(POLICY_QUERY_KEY, (current = []) => [
        ...current.filter((item) => item.hostname !== updated.hostname),
        updated
      ])
      props.onSuccess?.(updated)
      onClose()
      void message.success(`已保存 ${updated.hostname} 的并发限速策略，将在下一批次生效`)
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const handleSave = (values: ConcurrencyFormValues): void => {
    const targetHost = (fixedHostname || values.hostname || '').trim().toLowerCase()
    if (!targetHost) {
      form.setFields([{ name: 'hostname', errors: ['请输入或选择域名'] }])
      return
    }

    const min = values.batchIntervalMinSeconds ?? 0
    const max = values.batchIntervalMaxSeconds ?? 0
    if (!isValidBatchIntervalRange(min, max)) {
      form.setFields([{ name: 'batchIntervalMaxSeconds', errors: ['最大间隔不能小于最小间隔'] }])
      return
    }

    const payload: SaveHostnameCrawlPolicyInput = {
      hostname: targetHost,
      httpConcurrency: values.httpConcurrency ?? null,
      browserConcurrency: values.browserConcurrency ?? null,
      batchIntervalMinSeconds: values.batchIntervalMinSeconds ?? null,
      batchIntervalMaxSeconds: values.batchIntervalMaxSeconds ?? null
    }
    save.mutate(payload)
  }

  const autocompleteOptions = useMemo(
    () => availableHostnames.map((host) => ({ value: host, label: host })),
    [availableHostnames]
  )

  const tabItems = [
    {
      key: 'http',
      label: (
        <Space size={6}>
          <GlobalOutlined />
          <span>HTTP 并发设置</span>
          {currentPolicy?.httpConcurrency !== null &&
          currentPolicy?.httpConcurrency !== undefined ? (
            <span className="text-sm text-[var(--ant-color-primary)] font-semibold">
              ({currentPolicy.httpConcurrency})
            </span>
          ) : (
            <span className="text-sm text-[var(--ant-color-text-tertiary)]">
              (继承全局: {defaultHttp})
            </span>
          )}
        </Space>
      ),
      children: (
        <div className="space-y-4 pt-2">
          <Alert
            type="info"
            showIcon
            message="HTTP 纯文本抓取模式"
            description="适用于静态文档、HTML 页面、OpenAPI 规范与 llms.txt 等纯文本请求，网络开销小，支持配置较高并发。"
            className="text-sm"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Form.Item
              name="httpConcurrency"
              label="HTTP 最大并发数"
              tooltip={`同一域名下的最大 HTTP 并发请求数。留空表示继承全局设置 (${defaultHttp})。`}
            >
              <InputNumber
                min={APP_SETTINGS_LIMITS.concurrency.min}
                max={APP_SETTINGS_LIMITS.concurrency.max}
                placeholder={`继承全局 (${defaultHttp})`}
                className="w-full"
              />
            </Form.Item>
          </div>
        </div>
      )
    },
    {
      key: 'browser',
      label: (
        <Space size={6}>
          <ThunderboltOutlined />
          <span>无头浏览器并发</span>
          {currentPolicy?.browserConcurrency !== null &&
          currentPolicy?.browserConcurrency !== undefined ? (
            <span className="text-sm text-purple-600 font-semibold">
              ({currentPolicy.browserConcurrency})
            </span>
          ) : (
            <span className="text-sm text-[var(--ant-color-text-tertiary)]">
              (继承全局: {defaultBrowser})
            </span>
          )}
        </Space>
      ),
      children: (
        <div className="space-y-4 pt-2">
          <Alert
            type="warning"
            showIcon
            message="无头浏览器渲染模式 (Chromium / Playwright)"
            description="适用于 SPA 单页应用与重度 JS 渲染文档。浏览器实例占用 CPU 与内存较多，建议并发控制在 1~8 之间。"
            className="text-sm"
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Form.Item
              name="browserConcurrency"
              label="浏览器最大并发数"
              tooltip={`同一域名下的最大无头浏览器并发标签页数。留空表示继承全局设置 (${defaultBrowser})。`}
            >
              <InputNumber
                min={APP_SETTINGS_LIMITS.concurrency.min}
                max={APP_SETTINGS_LIMITS.concurrency.max}
                placeholder={`继承全局 (${defaultBrowser})`}
                className="w-full"
              />
            </Form.Item>
          </div>
        </div>
      )
    }
  ]

  return (
    <Modal
      open={open}
      title={
        <div className="flex items-center gap-2">
          <ThunderboltOutlined className="text-amber-500" />
          <span>{fixedHostname ? '配置域名抓取与并发限速' : '新增域名抓取限制'}</span>
          {fixedHostname && (
            <span className="font-mono text-sm text-[var(--ant-color-text-secondary)]">
              ({fixedHostname})
            </span>
          )}
        </div>
      }
      width={560}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          icon={<CheckOutlined />}
          loading={save.isPending}
          onClick={() => form.submit()}
        >
          保存配置
        </Button>
      ]}
    >
      <Form<ConcurrencyFormValues>
        form={form}
        layout="vertical"
        onFinish={handleSave}
        className="pt-1"
      >
        {!fixedHostname && (
          <Form.Item
            name="hostname"
            label="目标域名"
            rules={[{ required: true, message: '请选择或输入域名' }]}
            tooltip="同一域名下的所有文档库将共享此并发队列与限速策略"
            className="mb-4"
          >
            <AutoComplete
              options={autocompleteOptions}
              placeholder="例如: docs.example.com"
              onChange={handleHostnameChange}
            />
          </Form.Item>
        )}

        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as 'http' | 'browser')}
          items={tabItems}
        />

        {/* 批次抓取请求间隔通用设置 */}
        <div className="mt-4 border-t border-[var(--ant-color-border-secondary)] pt-3">
          <Typography.Text strong className="text-sm text-[var(--ant-color-text)]">
            批次请求等待间隔（防封禁限速）
          </Typography.Text>
          <Typography.Paragraph type="secondary" className="mb-2 text-sm">
            设置两批抓取请求之间的随机或固定等待间隔（秒），留空或设为 0 表示无等待连续抓取。
          </Typography.Paragraph>

          <div className="grid gap-3 sm:grid-cols-2">
            <Form.Item
              name="batchIntervalMinSeconds"
              label="最小等待间隔 (秒)"
              className="mb-0"
              rules={[
                {
                  validator: (_: unknown, val: unknown) =>
                    val === undefined || val === null || isValidBatchIntervalSeconds(val)
                      ? Promise.resolve()
                      : Promise.reject(new Error('请输入 0~60 之间的整数'))
                }
              ]}
            >
              <InputNumber min={0} max={60} placeholder="0" className="w-full" />
            </Form.Item>
            <Form.Item
              name="batchIntervalMaxSeconds"
              label="最大等待间隔 (秒)"
              className="mb-0"
              rules={[
                {
                  validator: (_: unknown, val: unknown) =>
                    val === undefined || val === null || isValidBatchIntervalSeconds(val)
                      ? Promise.resolve()
                      : Promise.reject(new Error('请输入 0~60 之间的整数'))
                }
              ]}
            >
              <InputNumber min={0} max={60} placeholder="0" className="w-full" />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  )
}
