import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'

/** 与 scripts/dev-web.mts 中的 API_PORT 默认值一致；复用已有服务时由 LOCI_DEV_API_PORT 覆盖 */
const devApiOrigin = `http://127.0.0.1:${process.env.LOCI_DEV_API_PORT ?? '12334'}`

export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), UnoCSS()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: {
    proxy: {
      '/api': devApiOrigin,
      '/health': devApiOrigin
    }
  }
})
