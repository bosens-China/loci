import { createLazyRoute } from '@tanstack/react-router'
import SettingsPage from '@renderer/components/SettingsPage'

export const Route = createLazyRoute('/settings')({
  component: SettingsPage
})
