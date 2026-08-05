import { beforeEach, describe, expect, it, vi } from 'vitest'

const ui = vi.hoisted(() => ({
  askConfirm: vi.fn<(message: string, initialValue?: boolean) => Promise<boolean>>(),
  askInteger:
    vi.fn<
      (
        message: string,
        options: { initialValue: number; minimum: number; maximum: number }
      ) => Promise<number>
    >(),
  askPassword: vi.fn<(message: string) => Promise<string>>(),
  askSelect:
    vi.fn<
      (message: string, options: readonly unknown[], initialValue?: string) => Promise<string>
    >(),
  askText: vi.fn<(message: string, options?: Record<string, unknown>) => Promise<string>>(),
  createSpinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
    error: vi.fn()
  })),
  failure: vi.fn(),
  info: vi.fn(),
  note: vi.fn(),
  printTable: vi.fn(),
  success: vi.fn(),
  warning: vi.fn()
}))

vi.mock('../../ui.js', () => ui)

import { askLibraryInput, askSchedule, formatScheduleLiveHint } from '../admin.js'

describe('CLI Admin 文档库交互', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('创建时先询问 URL，再用 URL 推导名称默认值', async () => {
    ui.askText.mockResolvedValueOnce('https://docs.rsbuild.dev/guide')
    ui.askText.mockResolvedValueOnce('rsbuild')
    ui.askInteger.mockResolvedValueOnce(1000)
    ui.askSelect.mockResolvedValueOnce('manual')

    await expect(askLibraryInput()).resolves.toEqual({
      name: 'rsbuild',
      url: 'https://docs.rsbuild.dev/guide',
      pageLimit: 1000,
      schedule: null
    })
    expect(ui.askText.mock.calls[0]?.[0]).toBe('起始页面 URL')
    expect(ui.askText.mock.calls[1]?.[0]).toBe('文档源名称')
    expect(ui.askText.mock.calls[1]?.[1]).toMatchObject({ initialValue: 'rsbuild' })
  })

  it('计划预设直接返回，自定义计划提供实时解释', async () => {
    ui.askSelect.mockResolvedValueOnce('*/15 * * * *')
    await expect(askSchedule(null)).resolves.toBe('*/15 * * * *')
    expect(ui.askText).not.toHaveBeenCalled()

    ui.askSelect.mockResolvedValueOnce('custom')
    ui.askText.mockResolvedValueOnce('0 2 * * *')
    await expect(askSchedule(null)).resolves.toBe('0 2 * * *')
    expect(ui.askText.mock.calls[0]?.[1]).toMatchObject({
      initialValue: '0 2 * * *',
      liveHint: formatScheduleLiveHint
    })
  })

  it('实时解释有效计划，并引导尚未写完的表达式', () => {
    expect(formatScheduleLiveHint('*/15 * * * *')).toContain('预计下次')
    expect(formatScheduleLiveHint('0 2')).toContain('继续输入有效的 5 段 Cron')
  })
})
