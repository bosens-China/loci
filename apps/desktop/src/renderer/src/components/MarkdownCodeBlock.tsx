import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vs, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

function detectLanguage(text: string, declaredLanguage?: string): string {
  if (declaredLanguage && declaredLanguage !== 'text' && declaredLanguage !== 'code') {
    return declaredLanguage
  }
  const code = text.trim()
  if (!code) return 'text'

  if (
    (code.startsWith('{') && code.endsWith('}')) ||
    (code.startsWith('[') && code.endsWith(']'))
  ) {
    try {
      JSON.parse(code)
      return 'json'
    } catch {
      // 继续使用轻量语法特征判断。
    }
  }
  if (/^<[a-z1-6]+/i.test(code) && /<\/[a-z1-6]+>/i.test(code)) return 'html'
  if (/^(npm|pnpm|yarn|npx|git|cd|docker|curl|chmod)\s/m.test(code)) return 'bash'
  if (/^\s*(def\s+\w+|import\s+\w+|from\s+\w+\s+import|class\s+\w+:)/m.test(code)) {
    return 'python'
  }
  return 'javascript'
}

export function MarkdownCodeBlock({
  language,
  value
}: {
  language: string
  value: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const isDark =
    typeof window !== 'undefined' &&
    (document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  const effectiveLang = detectLanguage(value, language)

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] shadow-sm dark:border-[#333333] dark:bg-[#1e1e1e]">
      <div className="flex items-center justify-between border-b border-solid border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-tertiary)] px-4 py-2 font-mono text-xs text-[var(--ant-color-text-tertiary)] dark:border-[#333333] dark:bg-[#252526] dark:text-gray-400">
        <div className="flex items-center gap-2">
          <div className="mr-1 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          </div>
          <span className="rounded bg-[#333333]/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:bg-[#333333] dark:text-blue-400">
            {effectiveLang}
          </span>
        </div>
        <Button
          size="small"
          type="text"
          icon={copied ? <CheckOutlined className="text-green-500" /> : <CopyOutlined />}
          className="h-7 text-xs text-[var(--ant-color-text-secondary)] transition-colors hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={handleCopy}
          aria-label="复制代码块"
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <SyntaxHighlighter
        language={effectiveLang}
        style={isDark ? vscDarkPlus : vs}
        customStyle={{
          margin: 0,
          padding: '16px 20px',
          fontSize: '13px',
          lineHeight: '1.7',
          fontFamily: 'Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace',
          background: isDark ? '#1e1e1e' : 'transparent'
        }}
        PreTag="div"
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}
