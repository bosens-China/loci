import { DeleteOutlined, PlusOutlined, ReloadOutlined, ToolOutlined } from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Typography
} from 'antd'
import { useState } from 'react'
import type { SkillInstallation, SkillOperationInput } from '@loci/shared'
import { useSkills } from '../hooks/useSkills'
import { SkillInstallModal } from './SkillInstallModal'

export default function SkillsPage(): React.JSX.Element {
  const { installations, loading, error, refresh, add, remove, clear, mutating } = useSkills()
  const [modalOpen, setModalOpen] = useState(false)
  const projectInstallations = installations.filter((item) => item.scope === 'project')

  const clearGlobal = (): void => {
    Modal.confirm({
      title: '清空全局 Loci Skills？',
      content: '只会删除 SQLite 台账和所有权标记确认由 Loci 管理的全局 Skill 目录。',
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => clear({ agent: 'all' })
    })
  }

  const clearProjects = (): void => {
    const roots = [...new Set(projectInstallations.map((item) => item.projectRoot).filter(Boolean))]
    Modal.confirm({
      title: '清空全部已记录项目 Skills？',
      content: roots.join('\n'),
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        for (const project of roots) await clear({ agent: 'all', project: project ?? undefined })
      }
    })
  }

  if (loading && !installations.length) return <Spin className="mt-24" />
  if (error && !installations.length) {
    return (
      <Alert
        type="error"
        showIcon
        message={error.message}
        action={<Button onClick={refresh}>重试</Button>}
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Typography.Title level={2} className="mb-1!">
            Skills 管理
          </Typography.Title>
          <Typography.Text type="secondary">
            管理 CLI 与桌面共同记录的 Loci Agent Skills。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={!installations.length || mutating}
            onClick={clearGlobal}
          >
            清空全局
          </Button>
          <Button
            danger
            disabled={!projectInstallations.length || mutating}
            onClick={clearProjects}
          >
            清空已记录项目
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            添加 Skill
          </Button>
        </Space>
      </div>

      <Card className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl">
        {installations.length ? (
          <Table<SkillInstallation>
            rowKey="id"
            pagination={false}
            scroll={{ x: 980 }}
            dataSource={installations}
            columns={[
              {
                title: 'Skill',
                dataIndex: 'name',
                render: (name: string) => (
                  <Space>
                    <ToolOutlined />
                    <Typography.Text strong>{name}</Typography.Text>
                  </Space>
                )
              },
              {
                title: 'Agent',
                dataIndex: 'compatibleAgents',
                render: (agents: string[]) => agents.map((agent) => <Tag key={agent}>{agent}</Tag>)
              },
              {
                title: '范围',
                render: (_, item) => (item.scope === 'global' ? '全局' : item.projectRoot)
              },
              {
                title: '状态',
                dataIndex: 'status',
                render: (status: string) => (
                  <Tag
                    color={
                      status === 'current' ? 'green' : status === 'conflict' ? 'red' : 'orange'
                    }
                  >
                    {status}
                  </Tag>
                )
              },
              {
                title: '目标路径',
                dataIndex: 'targetPath',
                render: (path: string) => (
                  <Typography.Text className="font-mono text-xs" copyable>
                    {path}
                  </Typography.Text>
                )
              },
              {
                title: '操作',
                fixed: 'right',
                width: 190,
                render: (_, item) => (
                  <Space>
                    <Popconfirm
                      title="确认整目录重新安装？"
                      description={
                        item.modified ? '检测到本地修改，重新安装后修改会丢失。' : item.targetPath
                      }
                      okText="重新安装"
                      cancelText="取消"
                      onConfirm={() => add(toInput(item))}
                    >
                      <Button size="small" icon={<ReloadOutlined />} loading={mutating}>
                        重新安装
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="确认整目录删除？"
                      description={
                        item.modified ? '检测到本地修改，删除后无法恢复。' : item.targetPath
                      }
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => remove(toInput(item))}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={mutating}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
          />
        ) : (
          <Empty description="暂无 Loci Skill 安装记录" />
        )}
      </Card>

      <SkillInstallModal
        open={modalOpen}
        loading={mutating}
        onCancel={() => setModalOpen(false)}
        onSubmit={async (input) => {
          await add(input)
          setModalOpen(false)
        }}
      />
    </div>
  )
}

function toInput(item: SkillInstallation): SkillOperationInput {
  return {
    name: item.name,
    agent: item.requestedAgent,
    project: item.projectRoot ?? undefined
  }
}
