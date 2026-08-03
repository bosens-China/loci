import { createLazyRoute } from '@tanstack/react-router'
import CloudLibrariesPage from '../components/CloudLibrariesPage'

export const Route = createLazyRoute('/admin/cloud')({ component: CloudLibrariesPage })
