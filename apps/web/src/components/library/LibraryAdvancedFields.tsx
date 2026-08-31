import { ClockCircleOutlined } from '@ant-design/icons'
import { AutoComplete, Button, Form, Input, InputNumber, Select, Space, Typography } from 'antd'
import {
  DOCUMENT_SOURCE_LIMITS,
  normalizeCronSchedule,
  SCHEDULE_PRESETS,
  type SourceKind
} from '@loci/shared'
import { getLibrarySchedulePreview } from './library-form'

export interface LibraryAdvancedFieldsProps {
  kind: SourceKind
  /** 仅计划与容量（用于 Server 云端库管理等场景） */
  scheduleAndLimitsOnly?: boolean
}

/**
 * 本地文档库与 Server 文档库的高级配置面板内容。
 * 包含所有高级字段的 Ant Design 校验规则（范围、格式、正则有效性等）。
 */
export function LibraryAdvancedFields(props: LibraryAdvancedFieldsProps): React.JSX.Element {
  const form = Form.useFormInstance()
  const schedule = Form.useWatch('schedule', form)
  const isGithub = props.kind === 'github'

  const scheduleRuns = getLibrarySchedulePreview(schedule)

  const dateTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    <div className="flex flex-col gap-4">
      {/* 子分类 1：计划与容量限制 */}
      <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)]/30 p-3.5">
        <div className="mb-3 text-xs font-semibold text-[var(--ant-color-text-secondary)] flex items-center gap-1.5">
          <span>⏱ 计划与容量限制</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            name="pageLimit"
            label={isGithub ? '文档上限（篇）' : '页面上限（页）'}
            rules={[
              { required: true, message: '请输入数量上限' },
              {
                type: 'number',
                min: DOCUMENT_SOURCE_LIMITS.pageLimit.min,
                max: DOCUMENT_SOURCE_LIMITS.pageLimit.max,
                message: `上限需在 ${DOCUMENT_SOURCE_LIMITS.pageLimit.min} 到 ${DOCUMENT_SOURCE_LIMITS.pageLimit.max} 之间`
              }
            ]}
            extra="单次收录的最大文档数量"
          >
            <InputNumber
              {...DOCUMENT_SOURCE_LIMITS.pageLimit}
              className="w-full"
              placeholder="默认 1000"
            />
          </Form.Item>

          <Form.Item
            name="schedule"
            label="自动更新计划"
            extra={
              scheduleRuns.length === 2 ? (
                <Typography.Text type="secondary" className="text-xs">
                  预计下次：{dateTime.format(scheduleRuns[0])}
                </Typography.Text>
              ) : (
                '留空仅手动同步；支持 Cron'
              )
            }
            rules={[
              {
                validator: (_rule, value: string | null | undefined) => {
                  if (!value || !value.trim()) return Promise.resolve()
                  try {
                    normalizeCronSchedule(value)
                    return Promise.resolve()
                  } catch (error) {
                    return Promise.reject(
                      error instanceof Error
                        ? error
                        : new Error('请输入合法的 5 段 Linux Cron 表达式')
                    )
                  }
                }
              }
            ]}
          >
            <AutoComplete
              allowClear
              options={SCHEDULE_PRESETS.map((preset) => ({
                value: preset.expression,
                label: `${preset.label} · ${preset.description}`
              }))}
            >
              <Input prefix={<ClockCircleOutlined />} placeholder="例如：0 2 * * *" />
            </AutoComplete>
          </Form.Item>
        </div>
      </div>

      {!props.scheduleAndLimitsOnly && (
        <>
          {/* 子分类 2：抓取与过滤 (Web) 或 仓库体积限制 (GitHub) */}
          {isGithub ? (
            <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)]/30 p-3.5">
              <div className="mb-3 text-xs font-semibold text-[var(--ant-color-text-secondary)] flex items-center gap-1.5">
                <span>📦 仓库体积与文件限制</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Form.Item label="GitHub ZIP 压缩包上限" extra="留空继承全局设置 (200MB)">
                  <Space.Compact block>
                    <Form.Item
                      name="githubArchiveLimitMb"
                      rules={[
                        {
                          type: 'number',
                          min: DOCUMENT_SOURCE_LIMITS.githubSizeMb.min,
                          max: DOCUMENT_SOURCE_LIMITS.githubSizeMb.max,
                          message: `ZIP 上限需在 ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.min} 到 ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.max} MB 之间`
                        }
                      ]}
                      noStyle
                    >
                      <InputNumber
                        {...DOCUMENT_SOURCE_LIMITS.githubSizeMb}
                        placeholder="继承全局设置 (200MB)"
                        className="w-full"
                      />
                    </Form.Item>
                    <Button disabled className="pointer-events-none">
                      MB
                    </Button>
                  </Space.Compact>
                </Form.Item>

                <Form.Item label="Markdown/MDX 单文件上限" extra="留空继承全局设置 (100MB)">
                  <Space.Compact block>
                    <Form.Item
                      name="githubMarkdownLimitMb"
                      rules={[
                        {
                          type: 'number',
                          min: DOCUMENT_SOURCE_LIMITS.githubSizeMb.min,
                          max: DOCUMENT_SOURCE_LIMITS.githubSizeMb.max,
                          message: `Markdown/MDX 上限需在 ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.min} 到 ${DOCUMENT_SOURCE_LIMITS.githubSizeMb.max} MB 之间`
                        }
                      ]}
                      noStyle
                    >
                      <InputNumber
                        {...DOCUMENT_SOURCE_LIMITS.githubSizeMb}
                        placeholder="继承全局设置 (100MB)"
                        className="w-full"
                      />
                    </Form.Item>
                    <Button disabled className="pointer-events-none">
                      MB
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)]/30 p-3.5">
                <div className="mb-3 text-xs font-semibold text-[var(--ant-color-text-secondary)] flex items-center gap-1.5">
                  <span>🌐 抓取方式与内容过滤</span>
                </div>
                <Form.Item
                  name="mode"
                  label="页面获取方式"
                  extra="普通站点会优先自动检查 llms.txt 和 OpenAPI；这里只控制普通网页使用 HTTP 直取还是浏览器渲染。"
                >
                  <Select
                    options={[
                      { value: 'auto', label: '自动检测（推荐，智能判断 SPA 与静态站点）' },
                      { value: 'http', label: '纯 HTTP（轻量极速，适用静态与服务端渲染）' },
                      { value: 'browser', label: '浏览器渲染（适用重度客户端渲染 SPA）' }
                    ]}
                  />
                </Form.Item>

                <Form.Item
                  name="excludePathPattern"
                  label="排除路径正则（可选）"
                  extra="新增或修改后，保存会立即删除匹配页面的正文和搜索索引。"
                  rules={[
                    {
                      max: DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max,
                      message: `正则长度不能超过 ${DOCUMENT_SOURCE_LIMITS.excludePathPatternLength.max} 个字符`
                    },
                    {
                      validator: (_rule, value: string | undefined) => {
                        if (!value || !value.trim()) return Promise.resolve()
                        try {
                          new RegExp(value.trim())
                          return Promise.resolve()
                        } catch {
                          return Promise.reject(new Error('请输入合法的正则表达式'))
                        }
                      }
                    }
                  ]}
                >
                  <Input placeholder="例如：^/(zh|de|fr)(?:/|$) 或 ^/v[0-9]+/" />
                </Form.Item>
              </div>

              <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)]/30 p-3.5">
                <div className="mb-3 text-xs font-semibold text-[var(--ant-color-text-secondary)] flex items-center gap-1.5">
                  <span>⚡ 网络并发覆盖</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Form.Item
                    name="httpConcurrency"
                    label="HTTP 并发覆盖"
                    extra="留空继承全局设置 (9)"
                    rules={[
                      {
                        type: 'number',
                        min: DOCUMENT_SOURCE_LIMITS.concurrency.min,
                        max: DOCUMENT_SOURCE_LIMITS.concurrency.max,
                        message: `并发数需在 ${DOCUMENT_SOURCE_LIMITS.concurrency.min} 到 ${DOCUMENT_SOURCE_LIMITS.concurrency.max} 之间`
                      }
                    ]}
                  >
                    <InputNumber
                      {...DOCUMENT_SOURCE_LIMITS.concurrency}
                      placeholder="继承全局设置 (9)"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="browserConcurrency"
                    label="浏览器并发覆盖"
                    extra="留空继承全局设置 (5)"
                    rules={[
                      {
                        type: 'number',
                        min: DOCUMENT_SOURCE_LIMITS.concurrency.min,
                        max: DOCUMENT_SOURCE_LIMITS.concurrency.max,
                        message: `并发数需在 ${DOCUMENT_SOURCE_LIMITS.concurrency.min} 到 ${DOCUMENT_SOURCE_LIMITS.concurrency.max} 之间`
                      }
                    ]}
                  >
                    <InputNumber
                      {...DOCUMENT_SOURCE_LIMITS.concurrency}
                      placeholder="继承全局设置 (5)"
                      className="w-full"
                    />
                  </Form.Item>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
