import { afterEach, describe, expect, it } from 'vitest'
import { confirmAction } from '../ui.js'

const isTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

afterEach(() => {
  if (isTtyDescriptor) Object.defineProperty(process.stdin, 'isTTY', isTtyDescriptor)
})

describe('CLI 操作确认', () => {
  it('非交互终端必须显式传入 yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false })

    await expect(confirmAction('确认操作？', true, '必须提供 --yes')).resolves.toBe(true)
    await expect(confirmAction('确认操作？', false, '必须提供 --yes')).rejects.toMatchObject({
      message: '必须提供 --yes',
      exitCode: 2
    })
  })
})
