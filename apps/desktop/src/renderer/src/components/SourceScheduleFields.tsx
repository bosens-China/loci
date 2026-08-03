import { Form, Input, Select, Switch, Tag, Tooltip, Typography } from 'antd'
import type { FormInstance } from 'antd'
import {
  CUSTOM_SCHEDULE,
  SCHEDULE_PRESETS,
  getNextScheduledRun,
  getSchedulePreset,
  normalizeCronSchedule
} from '@loci/shared'
import type { DocumentSource } from '../types'
import type { SourceFormValues } from './sourceScheduleForm'

interface SourceScheduleFieldsProps {
  form: FormInstance<SourceFormValues>
}

export function SourceScheduleTag({
  schedule
}: {
  schedule: DocumentSource['schedule']
}): React.JSX.Element {
  if (!schedule) return <Typography.Text type="secondary">未启用</Typography.Text>
  const preset = getSchedulePreset(schedule)
  return (
    <Tooltip title={`自动更新计划：${preset?.label ?? schedule}`}>
      <Tag bordered={false} color="blue" className="text-xs">
        {preset?.label ?? '自定义周期'}
      </Tag>
    </Tooltip>
  )
}

function SourceScheduleFields({ form }: SourceScheduleFieldsProps): React.JSX.Element {
  const enabled = Form.useWatch('scheduleEnabled', form)
  const preset = Form.useWatch('schedulePreset', form)
  const expression = Form.useWatch('scheduleExpression', form)
  const nextRun = enabled ? getNextScheduledRun(expression) : null
  const presetObj = getSchedulePreset(expression)

  return (
    <div className="space-y-4 pt-1">
      <div className="flex items-center justify-between rounded-lg border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-4">
        <div>
          <Typography.Text strong className="block text-sm">
            自动定时更新
          </Typography.Text>

          <Typography.Text type="secondary" className="text-xs">
            开启后，后台会定期自动检查该文档站是否有新内容并保持索引最新
          </Typography.Text>
        </div>
        <Form.Item name="scheduleEnabled" valuePropName="checked" className="mb-0!">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>
      </div>

      {enabled && (
        <div className="space-y-4 rounded-lg border border-solid border-blue-500/20 bg-blue-50/10 p-4 dark:bg-blue-950/10">
          <Form.Item
            name="schedulePreset"
            label="更新频率"
            rules={[{ required: true, message: '请选择更新频率' }]}
            className="mb-3!"
          >
            <Select
              size="large"
              options={[
                ...SCHEDULE_PRESETS.map((item) => ({
                  value: item.expression,
                  label: `${item.label} (${item.description})`
                })),
                { value: CUSTOM_SCHEDULE, label: '自定义高级周期' }
              ]}
              onChange={(value: string) => {
                if (value !== CUSTOM_SCHEDULE) {
                  form.setFieldValue('scheduleExpression', value)
                }
              }}
            />
          </Form.Item>

          {preset === CUSTOM_SCHEDULE && (
            <Form.Item
              name="scheduleExpression"
              label="自定义时间表达式"
              extra="高级参数（格式：分 时 日 月 周），普通用户无需调整。"
              rules={[
                { required: true, message: '请输入更新周期规则' },
                {
                  validator: (_, value: string) => {
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
              <Input className="font-mono" placeholder="例如：0 2 * * *" />
            </Form.Item>
          )}

          {nextRun && (
            <div className="space-y-1 rounded-md bg-blue-500/10 p-3 text-xs text-blue-600 dark:text-blue-400">
              <div className="flex items-center gap-1.5 font-medium">
                <span>💡 更新规划：</span>
                <span>{presetObj ? presetObj.description : '按设置的周期自动抓取'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>⏱️ 预计下一次自动更新时间：</span>
                <span className="font-mono font-semibold">
                  {new Intl.DateTimeFormat('zh-CN', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  }).format(nextRun)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SourceScheduleFields
