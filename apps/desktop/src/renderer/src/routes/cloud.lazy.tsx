import { createLazyRoute } from '@tanstack/react-router'
import CloudCatalogPage from '../components/CloudCatalogPage'

export const Route = createLazyRoute('/cloud')({ component: CloudCatalogPage })
