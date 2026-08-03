import { Slider } from 'antd'
import { getSourceScopeOptions } from './sourceFormUrl'

interface SourceScopeSelectorProps {
  url?: string
  value?: string
  onChange?: (value: string) => void
}

export function SourceScopeSelector({
  url = '',
  value = '/',
  onChange
}: SourceScopeSelectorProps): React.JSX.Element {
  const options = getSourceScopeOptions(url)
  if (!options.length) {
    return (
      <div className="rounded-lg bg-[var(--ant-color-fill-quaternary)] px-3 py-3 text-sm text-[var(--ant-color-text-tertiary)]">
        输入有效 URL 后可选择
      </div>
    )
  }
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )
  const selected = options[selectedIndex] ?? options[0]!
  const selectIndex = (index: number): void => onChange?.(options[index]?.value ?? '/')

  return (
    <div className="rounded-xl border border-solid border-[var(--ant-color-border)] px-4 pb-3 pt-2">
      {options.length > 1 ? (
        <Slider
          min={0}
          max={options.length - 1}
          step={1}
          value={selectedIndex}
          onChange={selectIndex}
          tooltip={{ formatter: (index) => options[index ?? 0]?.label }}
        />
      ) : null}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={index === selectedIndex}
            className={
              index <= selectedIndex
                ? 'shrink-0 cursor-pointer rounded-md border-0 bg-[var(--ant-color-primary-bg)] px-2 py-1 text-xs text-[var(--ant-color-primary-text)]'
                : 'shrink-0 cursor-pointer rounded-md border-0 bg-[var(--ant-color-fill-quaternary)] px-2 py-1 text-xs text-[var(--ant-color-text-tertiary)]'
            }
            onClick={() => selectIndex(index)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs text-[var(--ant-color-text-tertiary)]">
        将收录 {selected.label} 及其子路径
      </div>
    </div>
  )
}
