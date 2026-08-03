import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
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
