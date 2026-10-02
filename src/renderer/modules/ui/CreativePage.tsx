import { Box, Tabs } from '@mantine/core'
import { IconBook2, IconUsers } from '@tabler/icons-react'
import Page from '@/components/layout/Page'
import { CharactersTab, WorldBooksTab } from './ChatboxModPage'

/** 创作资料：世界书 + 人物卡 独立管理页（从设置页"创作资料"入口进入） */
export function CreativePage() {
  return (
    <Page title="创作资料">
      <Tabs defaultValue="worldbook" keepMounted={false} style={{ flex: 1, minHeight: 0 }}>
        <Tabs.List>
          <Tabs.Tab value="worldbook" leftSection={<IconBook2 size={16} />}>世界书</Tabs.Tab>
          <Tabs.Tab value="characters" leftSection={<IconUsers size={16} />}>人物卡</Tabs.Tab>
        </Tabs.List>
        <Box p="md" style={{ overflow: 'auto', height: '100%' }}>
          <Tabs.Panel value="worldbook"><WorldBooksTab /></Tabs.Panel>
          <Tabs.Panel value="characters"><CharactersTab /></Tabs.Panel>
        </Box>
      </Tabs>
    </Page>
  )
}
