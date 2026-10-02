import { createFileRoute } from '@tanstack/react-router'
import { CreativePage } from '@/modules/ui/CreativePage'

export const Route = createFileRoute('/settings/creative')({
  component: CreativePage,
})
