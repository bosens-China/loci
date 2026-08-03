import { createLazyRoute } from '@tanstack/react-router'
import CloudLibrariesPage from '@renderer/components/CloudLibrariesPage'

export const Route = createLazyRoute('/admin/cloud')({ component: CloudLibrariesPage })
