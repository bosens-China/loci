import {
  BookOutlined,
  CloudOutlined,
  DatabaseOutlined,
  HomeOutlined,
  SettingOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { AppRoute } from '@/routing'

const items: Array<{ route: AppRoute; label: string; icon: React.ReactNode }> = [
  { route: 'overview', label: '概览', icon: <HomeOutlined /> },
  { route: 'sources', label: '来源', icon: <DatabaseOutlined /> },
  { route: 'library', label: '文档库', icon: <BookOutlined /> },
  { route: 'cloud', label: '云端目录', icon: <CloudOutlined /> },
  { route: 'jobs', label: '任务', icon: <SyncOutlined /> },
  { route: 'settings', label: '设置', icon: <SettingOutlined /> }
]

interface AppShellProps {
  route: AppRoute
  onNavigate: (route: AppRoute) => void
  children: React.ReactNode
}

export function AppShell({ route, onNavigate, children }: AppShellProps): React.JSX.Element {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="relative overflow-hidden border-b border-[#d6e1e1] bg-[#193438] px-4 py-4 text-white lg:min-h-screen lg:border-b-0 lg:border-r lg:px-5 lg:py-7">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-b from-[#0a7c86] via-[#d38a22] to-[#b6423c]" />
        <div className="mb-4 pl-3 lg:mb-10">
          <div className="font-serif text-3xl tracking-tight">Loci</div>
          <div className="mt-1 text-[10px] font-700 tracking-[.2em] text-[#a9c2c4] uppercase">
            Local index
          </div>
        </div>
        <nav aria-label="主导航" className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-2">
          {items.map((item) => (
            <button
              key={item.route}
              type="button"
              aria-current={route === item.route ? 'page' : undefined}
              onClick={() => onNavigate(item.route)}
              className={`focus-ring flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-600 transition-colors lg:w-full ${
                route === item.route
                  ? 'bg-white text-[#193438] shadow-sm'
                  : 'text-[#d8e6e6] hover:bg-white/9 hover:text-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="mt-8 hidden border-t border-white/12 pt-5 text-xs leading-5 text-[#a9c2c4] lg:block">
          <div className="flex items-center gap-2 text-[#d8e6e6]">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#62c4ad] opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#62c4ad]" />
            </span>
            本地服务在线
          </div>
          <p className="mt-2">关掉浏览器后，定时与同步任务仍会继续。</p>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  )
}
