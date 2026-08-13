import { Button, Form, Input, Modal, Radio, Select, Space } from 'antd'
import { useEffect } from 'react'
import type { SkillAgent, SkillOperationInput } from '@loci/shared'

interface SkillInstallModalProps {
  open: boolean
  loading: boolean
  onCancel: () => void
  onSubmit: (input: SkillOperationInput) => Promise<void>
}

interface SkillFormValue {
  agent: SkillAgent
  scope: 'global' | 'project'
  project?: string
}

export function SkillInstallModal({
  open,
  loading,
  onCancel,
  onSubmit
}: SkillInstallModalProps): React.JSX.Element {
  const [form] = Form.useForm<SkillFormValue>()
  const scope = Form.useWatch('scope', form)
  useEffect(() => {
    if (open) form.setFieldsValue({ agent: 'universal', scope: 'global', project: undefined })
  }, [form, open])

  const selectProject = async (): Promise<void> => {
    const result = await window.api.selectSkillProject()
    if (!result.canceled && result.path) form.setFieldValue('project', result.path)
  }

  return (
    <Modal
      title="安装或重新安装 Skill"
      open={open}
      confirmLoading={loading}
      okText="确认安装"
      cancelText="取消"
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={(value) =>
          void onSubmit({
            name: 'use-loci',
            agent: value.agent,
            project: value.scope === 'project' ? value.project : undefined
          })
        }
      >
        <Form.Item label="Skill">
          <Input value="use-loci" disabled />
        </Form.Item>
        <Form.Item name="agent" label="Agent 客户端" rules={[{ required: true }]}>
          <Select
            options={[
              ['universal', '通用'],
              ['codex', 'Codex'],
              ['cursor', 'Cursor'],
              ['claude-code', 'Claude Code'],
              ['vscode', 'VS Code / Copilot'],
              ['antigravity', 'Antigravity'],
              ['all', '全部客户端']
            ].map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item name="scope" label="作用域" rules={[{ required: true }]}>
          <Radio.Group
            options={[
              { label: '全局', value: 'global' },
              { label: '项目', value: 'project' }
            ]}
          />
        </Form.Item>
        {scope === 'project' && (
          <Form.Item
            name="project"
            label="项目根目录"
            rules={[{ required: true, message: '请选择项目根目录' }]}
          >
            <Space.Compact className="w-full">
              <Input readOnly placeholder="请选择明确的项目目录" />
              <Button onClick={() => void selectProject()}>选择目录</Button>
            </Space.Compact>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
