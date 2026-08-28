import { BrowserManagerPanel } from '@/pages/browser/BrowserManagerPanel'

/** 本地工作区 - 无头浏览器管理页 */
export function BrowserPage(): React.JSX.Element {
  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <BrowserManagerPanel mode="local" />
    </div>
  )
}
