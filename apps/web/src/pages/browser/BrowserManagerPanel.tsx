import { LocalBrowserManagerPanel } from '@/pages/browser/LocalBrowserManagerPanel'
import { ServerBrowserPanel } from '@/pages/browser/ServerBrowserPanel'

interface BrowserManagerPanelProps {
  mode?: 'local' | 'cloud'
}

/** 本地安装管理与 Server 诊断共享页面入口，但保持不同的能力边界。 */
export function BrowserManagerPanel({
  mode = 'local'
}: BrowserManagerPanelProps): React.JSX.Element {
  return mode === 'local' ? <LocalBrowserManagerPanel /> : <ServerBrowserPanel />
}
