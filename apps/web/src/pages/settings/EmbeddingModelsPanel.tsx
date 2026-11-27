import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Progress, Space, Tag, Typography } from 'antd'
import { formatBytes, type EmbeddingModelStatus } from '@loci/shared'
import { cancelEmbeddingModel, installEmbeddingModel, listEmbeddingModels } from '@/api/models'
import { AsyncState } from '@/components/AsyncState'

const modelQueryKey = ['embedding-models']

const isRunning = ({ operation }: EmbeddingModelStatus) =>
  operation?.phase === 'downloading' || operation?.phase === 'indexing'

export function EmbeddingModelsPanel(): React.JSX.Element {
  const query = useQuery({
    queryKey: modelQueryKey,
    queryFn: listEmbeddingModels,
    refetchInterval: ({ state }) => (state.data?.some(isRunning) ? 1000 : 5000)
  })
  return (
    <AsyncState loading={query.isPending} error={query.error} onRetry={() => void query.refetch()}>
      <div className="space-y-4 pt-2">
        <Typography.Paragraph type="secondary">
          模型按需下载。普通搜索自动使用已索引的模型和关键词，向量计算在本机完成。
        </Typography.Paragraph>
        {query.data?.map((model) => (
          <ModelCard key={model.id} model={model} />
        ))}
      </div>
    </AsyncState>
  )
}

function ModelCard({ model }: { model: EmbeddingModelStatus }): React.JSX.Element {
  const client = useQueryClient()
  const { message } = App.useApp()
  const onSuccess = (updated: EmbeddingModelStatus) => {
    client.setQueryData<EmbeddingModelStatus[]>(modelQueryKey, (previous) =>
      previous?.map((status) => (status.id === updated.id ? updated : status))
    )
    void client.invalidateQueries({ queryKey: modelQueryKey })
  }
  const onError = (error: Error) => void message.error(error.message)
  const install = useMutation({ mutationFn: installEmbeddingModel, onSuccess, onError })
  const cancel = useMutation({ mutationFn: cancelEmbeddingModel, onSuccess, onError })
  const phase = model.operation?.phase
  const busy = isRunning(model)
  const ready = model.installed && model.indexed === model.total
  const percent =
    phase === 'downloading'
      ? Math.floor((100 * (model.operation?.downloadedBytes ?? 0)) / model.downloadBytes)
      : model.total
        ? Math.floor((100 * model.indexed) / model.total)
        : 0

  return (
    <Card
      title={
        <Space>
          {model.name}
          <Tag>{formatBytes(model.downloadBytes)}</Tag>
        </Space>
      }
      extra={
        busy ? (
          <Button loading={cancel.isPending} onClick={() => cancel.mutate(model.id)}>
            取消
          </Button>
        ) : (
          <Button
            type={model.installed ? 'default' : 'primary'}
            loading={install.isPending}
            disabled={!model.supported || (ready && !phase)}
            onClick={() => install.mutate(model.id)}
          >
            {phase ? '重试' : !model.installed ? '安装' : ready ? '已就绪' : '更新索引'}
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <Typography.Text type="secondary">
          {model.installed
            ? `已建立 ${model.indexed} / ${model.total} 篇文档的索引`
            : model.supported
              ? '按需下载模型文件。两个模型共用推理组件。'
              : '此平台不支持本机向量模型。'}
        </Typography.Text>
        {busy && (
          <Progress
            percent={percent}
            status="active"
            format={(value) => `${phase === 'downloading' ? '下载' : '建索引'} ${value}%`}
          />
        )}
        {phase === 'failed' && (
          <Alert type="error" showIcon title={model.operation?.error ?? '模型操作失败'} />
        )}
        {phase === 'cancelled' && <Alert type="info" showIcon title="操作已取消" />}
      </div>
    </Card>
  )
}
