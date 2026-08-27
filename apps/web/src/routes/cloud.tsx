import { createFileRoute } from '@tanstack/react-router'
import { CloudPage } from '@/pages/CloudPage'

export const Route = createFileRoute('/cloud')({ component: CloudPage })
