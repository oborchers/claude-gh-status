// Placeholder: the list pane is built on its own branch and replaces this file at merge.
// It draws just enough for the wiring tests: a row button per pull request of the page
// and the paging, draft, refresh, back and close buttons.

import type { RenderElement } from 'claude-code'

import { PAGE_SIZE, groupItems, paginate } from '../list'
import type { ListHandlers, ListView, UiTable } from './contract'

export function renderList(table: UiTable, view: ListView, handlers: ListHandlers): RenderElement {
  const { Box, Text, Button } = table
  const list = view.list
  if (list === null || list.kind !== 'list') return <Text>{list === null ? 'Open PRs' : `Open PRs (${list.kind})`}</Text>
  const shown = paginate(groupItems(list.items, list.account.login), view.page + 1, PAGE_SIZE, view.hideDrafts)
  return (
    <Box flexDirection="column">
      <Text>{`Open PRs ${shown.first}-${shown.last} of ${shown.total}, page ${shown.page}/${shown.pageCount}`}</Text>
      {shown.rows.map(row => (
        <Button key={`row-${row.item.number}`} plain onPress={() => handlers.selectPr(row.item.number)}>
          <Text>{`#${row.item.number} ${row.item.title}`}</Text>
        </Button>
      ))}
      <Box flexDirection="row" columnGap={2}>
        <Button key="next" plain hotkey="n" label="next" onPress={() => handlers.nextPage()} />
        <Button key="prev" plain hotkey="p" label="previous" onPress={() => handlers.prevPage()} />
        <Button key="drafts" plain hotkey="h" label={view.hideDrafts ? 'show drafts' : 'hide drafts'} onPress={() => handlers.toggleDrafts()} />
        <Button key="refresh" plain hotkey="r" label="refresh" onPress={() => handlers.refresh()} />
        <Button key="back" plain hotkey="b" label="back" onPress={() => handlers.back()} />
        <Button key="close" plain hotkey="x" label="close" onPress={() => handlers.closeList()} />
      </Box>
    </Box>
  )
}
