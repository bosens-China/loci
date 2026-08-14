import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from 'eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

// ESLint 专注于代码质量与语法检查；移除并屏蔽所有代码格式化规则，格式化统一交由 Prettier 在提交时处理
export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/doc_build', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@loci/core', '@loci/core/*', '@loci/runtime', '@loci/runtime/*'],
              message: 'Renderer 只能引用浏览器安全的 @loci/shared 领域契约。'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', '@loci/core', '@loci/core/*', '@loci/runtime', '@loci/runtime/*'],
              message: '@loci/shared 必须保持浏览器安全，不能依赖 Node 或上层实现。'
            }
          ]
        }
      ]
    }
  },
  // 禁用所有与格式化相关的 ESLint 规则
  eslintConfigPrettier
)
