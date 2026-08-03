import { ArrowRightOutlined, FileTextOutlined, FolderOutlined } from '@ant-design/icons'
import { Button, Card, Empty, List, Tag, Typography } from 'antd'
import type { DocumentItem } from '@/types'

interface OverviewRecentDocsProps {
  documents: DocumentItem[]
  onOpenLibrary: (documentId?: string, sourceId?: string) => void
}

/**
 * 首页最新收录知识节点列表组件
 */
export function OverviewRecentDocs({
  documents,
  onOpenLibrary
}: OverviewRecentDocsProps): React.JSX.Element {
  // 按更新时间降序展示前 5 条记录
  const recentDocs = [...documents]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)

  return (
    <Card
      className="border border-solid border-[var(--ant-color-border-secondary)] rounded-xl"
      title={<span className="font-semibold text-base">最近收录与更新的文档</span>}
      extra={
        <Button type="link" size="small" onClick={() => onOpenLibrary()} className="p-0">
          前往知识库 <ArrowRightOutlined />
        </Button>
      }
    >
      {recentDocs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无抓取记录" />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={recentDocs}
          renderItem={(doc) => (
            <List.Item
              className="hover:bg-[var(--ant-color-fill-alter)] px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              onClick={() => onOpenLibrary(doc.id, doc.sourceId)}
            >
              <List.Item.Meta
                avatar={
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
                    <FileTextOutlined />
                  </div>
                }
                title={
                  <div className="flex items-center gap-2">
                    <Typography.Text
                      strong
                      className="hover:text-primary transition-colors text-sm"
                    >
                      {doc.title || doc.url}
                    </Typography.Text>
                    {doc.language && doc.language !== 'und' && (
                      <Tag className="m-0 text-[10px] uppercase px-1 py-0">{doc.language}</Tag>
                    )}
                  </div>
                }
                description={
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                    <span className="text-gray-500 font-medium">{doc.sourceName}</span>
                    {doc.folder && (
                      <span className="flex items-center gap-1 font-mono">
                        <FolderOutlined />
                        {doc.folder}
                      </span>
                    )}
                  </div>
                }
              />
              <div className="text-xs type-secondary shrink-0 text-gray-400 font-mono">
                {doc.updatedAt}
              </div>
            </List.Item>
          )}
        />
      )}
    </Card>
  )
}
