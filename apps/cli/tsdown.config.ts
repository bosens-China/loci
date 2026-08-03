import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  clean: true,
  sourcemap: true,
  deps: {
    neverBundle: true,
    alwaysBundle: ['@loci/core', '@loci/shared']
  }
})
