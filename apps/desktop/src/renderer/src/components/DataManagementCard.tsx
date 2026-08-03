import {
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { Button, Card, Divider, Modal, Space, Typography, message } from 'antd'
import { useState } from 'react'
import { useAppSettings } from '../settings-context'

type Operation = 'export' | 'import' | 'clear'

function DataManagementCard(): React.JSX.Element {
  const { reload } = useAppSettings()
  const [operation, setOperation] = useState<Operation | null>(null)
  const [messageApi, messageHolder] = message.useMessage()
  const [modal, modalHolder] = Modal.useModal()

  const handleExport = async (): Promise<void> => {
    setOperation('export')
    try {
      const result = await window.api.exportData()
      if (!result.canceled) messageApi.success(result.message)
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '数据导出失败')
    } finally {
      setOperation(null)
    }
  }

  const handleImport = async (): Promise<void> => {
    setOperation('import')
    try {
      const result = await window.api.importData()
      if (result.canceled) return
      messageApi.success(result.message)
      try {
        await reload()
      } catch {
        messageApi.warning('数据已导入，但设置状态刷新失败，请重启应用')
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '数据导入失败')
    } finally {
      setOperation(null)
    }
  }

  const confirmImport = (): void => {
    modal.confirm({
      title: '覆盖当前本地数据？',
      content: '导入会替换当前文档源、文档、抓取记录和设置，建议先导出一份备份。',
      okText: '选择备份并导入',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: handleImport
    })
  }

  const handleClear = async (): Promise<void> => {
    setOperation('clear')
    try {
      const count = await window.api.clearDocuments()
      messageApi.success(count > 0 ? `已清空 ${count} 篇文档` : '当前没有可清空的文档')
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : '清空文档失败')
    } finally {
      setOperation(null)
    }
  }

  const confirmClear = (): void => {
    modal.confirm({
      title: '清空全部文档？',
      content: '这会永久删除所有已抓取文档和全文索引，但保留文档源与应用设置。此操作无法撤销。',
      okText: '清空全部文档',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: handleClear
    })
  }

  return (
    <Card
      title={
        <Space>
          <DatabaseOutlined /> 数据管理
        </Space>
      }
    >
      {messageHolder}
      {modalHolder}
      <Typography.Paragraph type="secondary">
        将全部本地数据导出为 JSON 备份。导入前会校验文件格式，并在事务中完整恢复。
      </Typography.Paragraph>
      <Space wrap>
        <Button
          icon={<DownloadOutlined />}
          loading={operation === 'export'}
          disabled={operation !== null && operation !== 'export'}
          onClick={() => void handleExport()}
        >
          导出备份
        </Button>
        <Button
          danger
          icon={<UploadOutlined />}
          loading={operation === 'import'}
          disabled={operation !== null && operation !== 'import'}
          onClick={confirmImport}
        >
          导入备份
        </Button>
      </Space>
      <Divider />
      <Typography.Text type="danger" strong>
        危险操作
      </Typography.Text>
      <Typography.Paragraph type="secondary" className="mb-3! mt-1! text-xs">
        清空全部已抓取文档与全文索引，文档源和设置不会受到影响。
      </Typography.Paragraph>
      <Button
        danger
        type="primary"
        icon={<DeleteOutlined />}
        loading={operation === 'clear'}
        disabled={operation !== null && operation !== 'clear'}
        onClick={confirmClear}
      >
        清空全部文档
      </Button>
    </Card>
  )
}

export default DataManagementCard
