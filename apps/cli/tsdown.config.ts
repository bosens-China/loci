import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  copy: [
    {
      from: '../../.agents/skills/use-loci',
      to: 'dist/resources/skills'
    },
    {
      from: '../web/dist',
      to: 'dist/resources/ui'
    }
  ],
  clean: true,
  sourcemap: true,
  deps: {
    // 私有 workspace 包必须连同子路径一起打入 CLI，不能留给全局安装解析。
    alwaysBundle: [/^@loci\/(?:core|runtime|shared)(?:\/.*)?$/, 'semver'],
    // 构建期阻止新的 @loci/* 外部引用混入发布产物。
    onlyImport: [/^(?!@loci\/)/]
  }
})
