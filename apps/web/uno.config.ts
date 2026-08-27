import { defineConfig, presetIcons, presetTypography, presetWind3 } from 'unocss'

export default defineConfig({
  presets: [presetWind3(), presetIcons(), presetTypography()]
})
