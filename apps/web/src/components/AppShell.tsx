import {
  CloudOutlined,
  FileTextOutlined,
  HomeOutlined,
  SettingOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { AppRoute } from '@/routing'

const items: Array<{ route: AppRoute; label: string; icon: React.ReactNode }> = [
  { route: 'overview', label: '概览', icon: <HomeOutlined /> },
  { route: 'documents', label: '文档', icon: <FileTextOutlined /> },
  { route: 'cloud', label: '云端', icon: <CloudOutlined /> },
  { route: 'jobs', label: '任务', icon: <SyncOutlined /> },
  { route: 'settings', label: '设置', icon: <SettingOutlined /> }
]

interface AppShellProps {
  route: AppRoute
  onNavigate: (route: AppRoute) => void
  children: React.ReactNode
}

/** 面向 PC / 笔记本的顶栏布局，不做小屏适配。 */
export function AppShell({ route, onNavigate, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="flex min-h-screen min-w-1200px flex-col bg-canvas text-ink">
      <header className="flex h-13 shrink-0 items-center gap-8 border-b border-[#2a3537] bg-shell px-6 text-white">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-xl font-600 tracking-tight">Loci</span>
          <span className="text-[10px] font-650 tracking-[.18em] text-[#8aa3a5] uppercase">
            本地文档
          </span>
        </div>
        <nav aria-label="主导航" className="flex items-center gap-1">
          {items.map((item) => (
            <button
              key={item.route}
              type="button"
              aria-current={route === item.route ? 'page' : undefined}
              onClick={() => onNavigate(item.route)}
              className={`focus-ring flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-600 transition-colors ${
                route === item.route
                  ? 'bg-white/12 text-white'
                  : 'text-[#b8cbcc] hover:bg-white/6 hover:text-white'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs text-[#b8cbcc]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#62c4ad] opacity-50 motion-reduce:animate-none" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#62c4ad]" />
          </span>
          本地服务在线
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  )
}
