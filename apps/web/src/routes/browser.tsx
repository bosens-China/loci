import { createFileRoute } from '@tanstack/react-router'
import { BrowserPage } from '@/pages/BrowserPage'

export const Route = createFileRoute('/browser')({ component: BrowserPage })
