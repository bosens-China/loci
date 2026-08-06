import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@resources': fileURLToPath(new URL('./resources', import.meta.url))
      }
    },
    build: {
      externalizeDeps: {
        exclude: ['@loci/core', '@loci/runtime', '@loci/shared', 'semver']
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@resources': fileURLToPath(new URL('./resources', import.meta.url))
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
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
