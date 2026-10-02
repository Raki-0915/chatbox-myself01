import { createFileRoute } from '@tanstack/react-router'
import { ChatboxModPage } from '@/modules/ui/ChatboxModPage'

export const Route = createFileRoute('/settings/mod')({
  component: ChatboxModPage,
})
