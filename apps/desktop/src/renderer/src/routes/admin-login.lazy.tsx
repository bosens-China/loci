import { createLazyRoute } from '@tanstack/react-router'
import AdminLoginPage from '../components/AdminLoginPage'

export const Route = createLazyRoute('/admin/login')({ component: AdminLoginPage })
