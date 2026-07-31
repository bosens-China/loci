import { Collapse, Form, Input, Select, Switch, Tag, Tooltip, Typography } from 'antd'
import type { FormInstance } from 'antd'
import {
  CUSTOM_SCHEDULE,
  SCHEDULE_PRESETS,
  getNextScheduledRun,
  getSchedulePreset,
  normalizeCronSchedule
} from '@shared/schedule'
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
  return (
    <Tooltip title={`Linux Cron：${schedule}`}>
      <Tag color="blue">{getSchedulePreset(schedule)?.label ?? '自定义'}</Tag>
    </Tooltip>
  )
}

function SourceScheduleFields({ form }: SourceScheduleFieldsProps): React.JSX.Element {
  const enabled = Form.useWatch('scheduleEnabled', form)
  const preset = Form.useWatch('schedulePreset', form)
  const expression = Form.useWatch('scheduleExpression', form)
  const nextRun = enabled ? getNextScheduledRun(expression) : null

  return (
    <Collapse
      ghost
      className="mt-1"
      items={[
        {
          key: 'schedule',
          label: (
            <span>
              高级配置 <Typography.Text type="secondary">定时抓取</Typography.Text>
            </span>
          ),
          children: (
            <div className="pb-2">
              <Form.Item name="scheduleEnabled" label="定时抓取" valuePropName="checked">
                <Switch checkedChildren="已启用" unCheckedChildren="未启用" />
              </Form.Item>
              {enabled && (
                <>
                  <Form.Item name="schedulePreset" label="更新频率" rules={[{ required: true }]}>
                    <Select
                      options={[
                        ...SCHEDULE_PRESETS.map((item) => ({
                          value: item.expression,
                          label: `${item.label} · ${item.description}`
                        })),
                        { value: CUSTOM_SCHEDULE, label: '自定义 Linux Cron' }
                      ]}
                      onChange={(value: string) => {
                        if (value !== CUSTOM_SCHEDULE)
                          form.setFieldValue('scheduleExpression', value)
                      }}
                    />
                  </Form.Item>
                  {preset === CUSTOM_SCHEDULE && (
                    <Form.Item
                      name="scheduleExpression"
                      label="Cron 表达式"
                      extra="使用本机时区，格式为 分 时 日 月 周；最短间隔为 1 分钟。"
                      rules={[
                        { required: true, message: '请输入 Cron 表达式' },
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
                    <Typography.Text type="secondary" className="block -mt-2 text-xs">
                      下次抓取：
                      {new Intl.DateTimeFormat('zh-CN', {
                        dateStyle: 'medium',
                        timeStyle: 'short'
                      }).format(nextRun)}
                    </Typography.Text>
                  )}
                </>
              )}
            </div>
          )
        }
      ]}
    />
  )
}

export default SourceScheduleFields
