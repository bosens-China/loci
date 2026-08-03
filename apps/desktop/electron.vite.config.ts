import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'

const desktopRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(desktopRoot, 'src/renderer/src'),
        '@shared': resolve(desktopRoot, 'src/shared')
      }
    },
    plugins: [
      UnoCSS(),
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', {}]]
        }
      })
    ]
  }
})
