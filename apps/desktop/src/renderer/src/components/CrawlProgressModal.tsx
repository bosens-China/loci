import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined
} from '@ant-design/icons'
import { Button, Modal, Progress, Space, Tag, Typography } from 'antd'
import type { ECharts, EChartsOption } from 'echarts'
import * as echarts from 'echarts/core'
import { TreeChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import type { CrawlNode, CrawlProgress } from '../types'
import { buildCrawlTree, type CrawlTreeNode } from './crawlTree'

echarts.use([TreeChart, TooltipComponent, CanvasRenderer])

interface CrawlProgressModalProps {
  open: boolean
  sourceName: string
  progress: CrawlProgress
  nodes: CrawlNode[]
  error: string | null
  running: boolean
  paused: boolean
  onPause: () => void
  onResume: () => void
  onClose: () => void
}

interface EChartsTreeNode {
  name: string
  value: string
  symbolSize: number
  itemStyle: {
    color: string
    borderColor?: string
    borderWidth?: number
    shadowBlur?: number
    shadowColor?: string
  }
  children: EChartsTreeNode[]
}

function CrawlProgressModal({
  open,
  sourceName,
  progress,
  nodes,
  error,
  running,
  paused,
  onPause,
  onResume,
  onClose
}: CrawlProgressModalProps): React.JSX.Element {
  const currentNode = progress.node ?? nodes[nodes.length - 1]
  const percent = progress.queued
    ? Math.min(100, Math.round((progress.processed / progress.queued) * 100))
    : 0
  const status = error
    ? 'failed'
    : running
      ? 'running'
      : progress.failed > 0
        ? 'warning'
        : 'success'
  const nodeStatus = currentNode?.status ?? 'running'

  return (
    <Modal
      open={open}
      width={920}
      title={`同步文档源 · ${sourceName}`}
      onCancel={onClose}
      footer={
        <Space>
          {running &&
            (paused ? (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={onResume}>
                恢复
              </Button>
            ) : (
              <Button icon={<PauseCircleOutlined />} onClick={onPause}>
                暂停
              </Button>
            ))}
          <Button onClick={onClose}>{running ? '后台运行' : '关闭'}</Button>
        </Space>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <Space orientation="vertical" size={2} className="min-w-0">
          <Space size={8}>
            {status === 'running' && (paused ? <PauseCircleOutlined /> : <LoadingOutlined spin />)}
            {status === 'success' && <CheckCircleOutlined />}
            {(status === 'failed' || status === 'warning') && <ExclamationCircleOutlined />}
            <Typography.Text strong>{currentNode?.title ?? '等待首页响应'}</Typography.Text>
            <Tag color={nodeStatusColor(nodeStatus)}>{nodeStatusLabel(nodeStatus)}</Tag>
          </Space>
          <Typography.Text type="secondary" ellipsis className="max-w-[560px] text-xs">
            {currentNode?.url ?? '正在建立抓取任务'}
          </Typography.Text>
        </Space>
        <div className="min-w-[280px]">
          <div className="mb-1 flex items-center justify-between gap-3 whitespace-nowrap text-xs">
            <span className="min-w-0">
              {error ??
                (paused
                  ? '已暂停，恢复后继续抓取'
                  : running
                    ? '正在发现并整理页面'
                    : progress.failed > 0
                      ? '抓取完成，部分页面失败'
                      : '抓取完成')}
            </span>
            <span>
              {progress.processed} / {progress.queued} 页
            </span>
          </div>
          <Progress percent={percent} showInfo={false} status={error ? 'exception' : undefined} />
        </div>
      </div>
      <CrawlTree nodes={nodes} />
      <Typography.Text type="secondary" className="block text-center text-xs">
        滚轮缩放，拖动查看；点击节点可收起或展开分支。
      </Typography.Text>
      {nodes.length > 100 && (
        <Typography.Text type="secondary">
          层级图展示最先发现的 100 个页面，统计数据为全量。
        </Typography.Text>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Tag color="processing">已发现 {progress.queued}</Tag>
        <Tag color="success">成功 {progress.succeeded}</Tag>
        <Tag color={progress.failed > 0 ? 'error' : 'default'}>失败 {progress.failed}</Tag>
        {progress.limitReached && <Tag color="warning">已达到页面上限</Tag>}
      </div>
    </Modal>
  )
}

function CrawlTree({ nodes }: { nodes: CrawlNode[] }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = echarts.init(containerRef.current)
    chartRef.current = chart
    chart.setOption(createTreeOption([]))
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(containerRef.current)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(
      () => chartRef.current?.setOption(createTreeOption(selectTreeNodes(nodes))),
      100
    )
    return () => clearTimeout(timer)
  }, [nodes])

  return <div ref={containerRef} className="h-[440px] w-full" />
}

function selectTreeNodes(nodes: readonly CrawlNode[]): readonly CrawlNode[] {
  if (nodes.length <= 100) return nodes
  // ponytail: 保留抓取顺序的前 100 个节点，确保每个节点的父级仍在树中；超大站点需要独立全量拓扑页时再实现。
  return nodes.slice(0, 100)
}

function createTreeOption(nodes: readonly CrawlNode[]): EChartsOption {
  const tree = buildCrawlTree(nodes)
  const isDark =
    typeof window !== 'undefined' &&
    (document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  const lineColor = isDark ? '#595959' : '#d9d9d9'

  return {
    tooltip: { show: false },
    series: tree
      ? [
          {
            type: 'tree',
            data: [toEChartsTreeNode(tree, 0, isDark)],
            top: '8%',
            left: '8%',
            right: '8%',
            bottom: '8%',
            layout: 'radial',
            roam: true,
            expandAndCollapse: true,
            initialTreeDepth: -1,
            symbol: 'circle',
            symbolSize: 14,
            lineStyle: { color: lineColor, width: 1.5, curveness: 0.25 },
            label: { position: 'right', verticalAlign: 'middle', align: 'left', fontSize: 11 },
            leaves: { label: { position: 'right', verticalAlign: 'middle', align: 'left' } },
            emphasis: { focus: 'descendant', lineStyle: { width: 3 } },
            animationDuration: 450,
            animationDurationUpdate: 250
          }
        ]
      : []
  }
}

function toEChartsTreeNode(node: CrawlTreeNode, depth = 0, isDark = false): EChartsTreeNode {
  return {
    name: shorten(node.name),
    value: node.url,
    symbolSize: depth === 0 ? 36 : node.children.length > 0 ? 20 : 14,
    itemStyle:
      depth === 0
        ? {
            color: colorForStatus(node.status),
            borderColor: isDark ? '#141414' : '#ffffff',
            borderWidth: 4,
            shadowBlur: 16,
            shadowColor: isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.2)'
          }
        : { color: colorForStatus(node.status) },
    children: node.children.map((child) => toEChartsTreeNode(child, depth + 1, isDark))
  }
}

function colorForStatus(status: CrawlNode['status']): string {
  if (status === 'failed') return '#ff7875'
  if (status === 'queued') return '#91caff'
  if (status === 'running') return '#13c2c2'
  return '#52c41a'
}

function nodeStatusColor(status: CrawlNode['status']): string {
  if (status === 'failed') return 'error'
  if (status === 'queued') return 'processing'
  if (status === 'running') return 'cyan'
  return 'success'
}

function nodeStatusLabel(status: CrawlNode['status']): string {
  if (status === 'failed') return '失败'
  if (status === 'queued') return '等待抓取'
  if (status === 'running') return '抓取中'
  return '已完成'
}

function shorten(value: string): string {
  return value.length > 24 ? `${value.slice(0, 23)}…` : value
}

export default CrawlProgressModal
