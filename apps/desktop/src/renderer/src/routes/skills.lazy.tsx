import { createLazyRoute } from '@tanstack/react-router'
import SkillsPage from '../components/SkillsPage'

export const Route = createLazyRoute('/skills')({ component: SkillsPage })
