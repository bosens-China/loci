import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('apps/desktop/src/renderer/src'),
      '@shared': resolve('apps/desktop/src/shared')
    }
  }
})
