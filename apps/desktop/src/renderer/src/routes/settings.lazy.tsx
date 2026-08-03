import { createLazyRoute } from '@tanstack/react-router'
import SettingsPage from '../components/SettingsPage'

export const Route = createLazyRoute('/settings')({
  component: SettingsPage
})
