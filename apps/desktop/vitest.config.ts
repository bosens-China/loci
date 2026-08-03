import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@resources': fileURLToPath(new URL('./resources', import.meta.url))
    }
  },
  test: {
    exclude: [...configDefaults.exclude, '**/dist/**', '**/out/**']
  }
})
