import { defineConfig, presetIcons, presetTypography, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3(), presetIcons(), presetTypography()],
  shortcuts: {
    panel: 'rounded-xl border border-[#d8e0e0] bg-white',
    'panel-muted': 'rounded-xl border border-[#d8e0e0] bg-[#f8fafa]',
    'workspace-pane': 'flex flex-col overflow-hidden border-[#d8e0e0] bg-white',
    'pane-header':
      'flex shrink-0 items-center justify-between gap-3 border-b border-[#e4eaea] bg-[#f6f9f8] px-4 py-2.5',
    'pane-title': 'text-xs font-650 tracking-wide text-[#4a5f61] uppercase',
    eyebrow: 'text-[11px] font-650 tracking-[.14em] text-[#5a7274] uppercase',
    'focus-ring': 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0a7c86]/30'
  },
  theme: {
    fontFamily: {
      sans: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
      serif: '"Iowan Old Style", "Songti SC", serif',
      mono: '"SFMono-Regular", Consolas, monospace'
    },
    colors: {
      ink: '#152224',
      muted: '#5f7375',
      accent: '#0a7c86',
      shell: '#1a2426',
      canvas: '#eef3f2'
    }
  }
})
