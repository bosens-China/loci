import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 集成测试包含 Crawlee 队列轮询和跨进程任务收口，预留 CI 调度时间。
    testTimeout: 15_000,
    exclude: [...configDefaults.exclude, '**/dist/**', '**/out/**']
  }
})
