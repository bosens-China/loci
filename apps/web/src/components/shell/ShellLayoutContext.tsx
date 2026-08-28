import { createContext, useContext, useEffect } from 'react'

interface ShellLayoutContextValue {
  /** 是否跳过白色内容面板直接撑满 Layout.Content（供全屏工作区页面使用） */
  rawLayout: boolean
  setRawLayout: (raw: boolean) => void
}

export const ShellLayoutContext = createContext<ShellLayoutContextValue>({
  rawLayout: false,
  setRawLayout: () => {}
})

/**
 * 在全屏工作区组件顶层调用，mount 时切换为 raw 布局（无白色面板、无外边距），
 * unmount 时自动还原。适用于文档阅读器、数据全屏视图等需要撑满整个内容区的页面。
 */
export function useRawLayout(): void {
  const { setRawLayout } = useContext(ShellLayoutContext)
  useEffect(() => {
    setRawLayout(true)
    return () => {
      setRawLayout(false)
    }
  }, [setRawLayout])
}
