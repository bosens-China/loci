import { ClockCircleOutlined, LinkOutlined } from '@ant-design/icons'
import { AutoComplete, Form, Input, InputNumber, Select, Typography } from 'antd'
import {
  DOCUMENT_SOURCE_DEFAULTS,
  DOCUMENT_SOURCE_LIMITS,
  getSourceScopeOptions,
  normalizeCronSchedule,
  SCHEDULE_PRESETS,
  type SourceKind
} from '@loci/shared'
import {
  getLibrarySchedulePreview,
  getLibraryUrlDefaults,
  validateLibrarySourceKind
} from './library-form'

export interface LibraryCoreFormValue {
  name: string
  url: string
  scopePath: string
  pageLimit: number
  schedule?: string | null
}

/** 本地来源与 Server 文档库共用的基础抓取配置。 */
export function LibraryCoreFields(props: {
  autoFocusUrl?: boolean
  suggestName?: boolean
  kind?: SourceKind
}): React.JSX.Element {
  const form = Form.useFormInstance<LibraryCoreFormValue>()
  const url = Form.useWatch('url', form) ?? ''
  const schedule = Form.useWatch('schedule', form)
  const scopeOptions = getSourceScopeOptions(url)
  const scheduleRuns = getLibrarySchedulePreview(schedule)
  const dateTime = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

  const applyUrlDefaults = (inputUrl: string): void => {
    form.setFieldsValue(
      getLibraryUrlDefaults({
        url: inputUrl,
        name: form.getFieldValue('name') ?? '',
        scopePath: form.getFieldValue('scopePath') ?? DOCUMENT_SOURCE_DEFAULTS.scopePath,
        nameTouched: form.isFieldTouched('name'),
        suggestName: props.suggestName === true
      })
    )
  }

  return (
    <>
      <Form.Item
        name="url"
        label={props.kind === 'github' ? 'GitHub 仓库 URL' : '起始页面 URL'}
        rules={[
          { required: true, type: 'url', message: '请输入完整 URL' },
          {
            validator: (_rule, value: string | undefined) => {
              if (!value || !props.kind) return Promise.resolve()
              const message = validateLibrarySourceKind(props.kind, value)
              return message ? Promise.reject(new Error(message)) : Promise.resolve()
            }
          }
        ]}
      >
        <Input
          autoFocus={props.autoFocusUrl}
          prefix={<LinkOutlined />}
          placeholder={
            props.kind === 'github'
              ? 'https://github.com/owner/repository'
              : 'https://example.com/docs'
          }
          onChange={(event) => applyUrlDefaults(event.currentTarget.value)}
          onBlur={(event) => applyUrlDefaults(event.currentTarget.value)}
        />
      </Form.Item>
      <Form.Item
        name="name"
        label="名称"
        rules={[
          { required: true, message: '请输入名称' },
          { max: DOCUMENT_SOURCE_LIMITS.nameLength.max, message: '名称过长' }
        ]}
      >
        <Input
          maxLength={DOCUMENT_SOURCE_LIMITS.nameLength.max}
          placeholder="例如：Hono 官方文档"
        />
      </Form.Item>
      {props.kind === 'web' ? (
        <div className="grid grid-cols-2 gap-3">
          <Form.Item
            name="scopePath"
            label="收录范围"
            extra="只收录所选路径及其子路径；编辑时收窄范围会立即删除范围外正文。"
            rules={[{ required: true, message: '请选择收录范围' }]}
          >
            <Select
              options={scopeOptions}
              placeholder={url ? '选择路径范围' : '先填写起始页面 URL'}
              disabled={!scopeOptions.length}
            />
          </Form.Item>
          <PageLimitField />
        </div>
      ) : (
        <PageLimitField />
      )}
      <Form.Item
        name="schedule"
        label="自动更新计划"
        extra={
          scheduleRuns.length === 2 ? (
            <Typography.Text type="secondary" className="text-xs">
              预计下次：{dateTime.format(scheduleRuns[0])}；再下次：
              {dateTime.format(scheduleRuns[1])}
            </Typography.Text>
          ) : (
            '留空表示仅手动同步；也可以填写五段 Linux Cron。'
          )
        }
        rules={[
          {
            validator: (_rule, value: string | null | undefined) => {
              try {
                normalizeCronSchedule(value)
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
          options={SCHEDULE_PRESETS.map((preset) => ({
            value: preset.expression,
            label: `${preset.label} · ${preset.description}`
          }))}
        >
          <Input prefix={<ClockCircleOutlined />} placeholder="例如：0 2 * * *" />
        </AutoComplete>
      </Form.Item>
    </>
  )
}

function PageLimitField(): React.JSX.Element {
  return (
    <Form.Item
      name="pageLimit"
      label="页面上限（页）"
      rules={[{ required: true, message: '请输入页面上限' }]}
    >
      <InputNumber {...DOCUMENT_SOURCE_LIMITS.pageLimit} className="w-full" />
    </Form.Item>
  )
}
