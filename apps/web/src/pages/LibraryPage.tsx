import { useDeferredValue, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { listDocuments } from '@/api/documents'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'

export function LibraryPage(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const sourceId = new URLSearchParams(window.location.search).get('source') ?? ''
  const query = useQuery({
    queryKey: ['documents', deferredSearch, sourceId],
    queryFn: () => listDocuments(deferredSearch, sourceId)
  })
  const selectedId = new URLSearchParams(window.location.search).get('document')
  const selected = query.data?.find((document) => document.id === selectedId) ?? query.data?.[0]
  const select = (id: string): void => {
    const url = new URL(window.location.href)
    url.searchParams.set('document', id)
    window.history.replaceState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
  return (
    <>
      <PageHeader
        eyebrow="Local library"
        title="文档库"
        description="搜索已抓取的技术文档，并用 URL 保留当前阅读位置。"
        action={
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题与正文"
            className="w-full sm:w-72"
          />
        }
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        empty={query.data?.length === 0}
        emptyText={deferredSearch ? '没有匹配的文档' : '同步来源后，文档会出现在这里'}
        onRetry={() => void query.refetch()}
      >
        <div className="grid min-h-65vh gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="panel max-h-[72vh] overflow-y-auto p-2">
            {query.data?.map((document) => (
              <button
                key={document.id}
                type="button"
                onClick={() => select(document.id)}
                className={`focus-ring block w-full rounded-xl border-l-3 px-4 py-3 text-left transition-colors ${selected?.id === document.id ? 'border-[#0a7c86] bg-[#eaf4f3]' : 'border-transparent hover:bg-[#f3f7f6]'}`}
              >
                <div className="line-clamp-2 text-sm font-650 leading-5">{document.title}</div>
                <div className="mt-1 truncate text-xs text-[#718486]">
                  {document.sourceName} · {document.language}
                </div>
              </button>
            ))}
          </div>
          {selected && (
            <article className="panel min-w-0 overflow-hidden">
              <header className="border-b border-[#e0e8e8] bg-[#f7faf9] px-5 py-5 sm:px-8">
                <div className="eyebrow">{selected.sourceName}</div>
                <h2 className="mb-0 mt-2 font-serif text-2xl">{selected.title}</h2>
                <a
                  className="mt-2 block truncate text-xs text-[#0a727b] hover:underline"
                  href={selected.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selected.url}
                </a>
              </header>
              <div className="prose prose-slate max-w-none overflow-x-auto px-5 py-6 text-sm leading-7 sm:px-8">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
              </div>
            </article>
          )}
        </div>
      </AsyncState>
    </>
  )
}
