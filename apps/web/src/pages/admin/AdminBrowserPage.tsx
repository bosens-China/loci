import { BrowserManagerPanel } from '@/pages/browser/BrowserManagerPanel'

/** 云端 Server - 无头浏览器管理独立页面 */
export function AdminBrowserPage(): React.JSX.Element {
  return <BrowserManagerPanel mode="cloud" />
}
