import { defineConfig, presetIcons, presetTypography, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3(), presetIcons(), presetTypography()],
  shortcuts: {
    panel:
      'rounded-2xl border border-[#dbe3e4] bg-white/86 shadow-[0_18px_50px_-36px_rgba(16,42,45,.55)]',
    eyebrow: 'text-[11px] font-700 tracking-[.18em] text-[#567174] uppercase',
    'focus-ring': 'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#0a7c86]/25'
  },
  theme: {
    fontFamily: {
      sans: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
      serif: '"Iowan Old Style", "Songti SC", serif',
      mono: '"SFMono-Regular", Consolas, monospace'
    }
  }
})
