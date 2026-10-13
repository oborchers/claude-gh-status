// A rig for the UI module tests: mounts a pure render function on both surfaces and reads
// what it drew as plain lines, the way list-ui.test.ts does.

import type { Engine, Mounted as MountedOf } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import type { UiTable } from '../../src/ui/contract'

export const SURFACES = ['terminal', 'desktop'] as const
export type Surface = (typeof SURFACES)[number]
export type Mounted = Pick<MountedOf<Surface, 'Pane'>, 'drawn' | 'find' | 'findAll' | 'press' | 'unmount'>

export type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[]; hover?: unknown }

export function createRig<V extends { surface?: Surface }, H>(on: On, render: (table: UiTable, view: V, handlers: H) => RenderElement) {
  let current: { view: V; handlers: H } | null = null
  let serial = 0
  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (current === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    return render($.ui.resolve(e), current.view, current.handlers)
  })
  return {
    show($: Engine, surface: Surface, view: V, handlers: H, columns: number): Promise<Mounted> {
      current = { view: { ...view, surface }, handlers }
      const props = { title: 'Rig', isFocused: true, bodyColumns: columns, placement: 'inline' }
      return $.ui.mount({ plugin: 'test', surface, component: 'Pane', requestId: `rig-${(serial += 1)}`, props: props as never })
    },
  }
}

export function rowsOf(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  const element = node as Node
  const props = element.props ?? {}
  const children = element.children ?? []
  if (element.type === 'Button' || element.type === 'Link') {
    const text = children.length > 0 ? children.flatMap(rowsOf).join('') : String(props.label ?? '')
    return (props.hotkey !== undefined && props.plain === true ? `${String(props.hotkey)}: ${text}` : text).split('\n')
  }
  const parts = children.map((child) => {
    const margin = Number((child as Node).props?.marginLeft ?? 0)
    return rowsOf(child).map((line) => ' '.repeat(margin) + line)
  })
  if (props.flexDirection === 'column') return parts.flat()
  const gap = Number(props.columnGap ?? props.gap ?? 0)
  return [parts.map((lines) => lines.join('\n')).join(' '.repeat(gap))]
}

/** The drawn lines, without the padding a focused row is filled to the width with. */
export const linesOf = async (ui: Mounted): Promise<string[]> => rowsOf(await ui.drawn()).map((line) => line.trimEnd())
export const textOf = async (ui: Mounted): Promise<string> => (await linesOf(ui)).join('\n')

export function nodesOf(node: unknown): Node[] {
  if (typeof node === 'string' || node === null || node === undefined) return []
  const element = node as Node
  return [element, ...(element.children ?? []).flatMap(nodesOf)]
}

export const textsOf = (row: unknown): Node[] => nodesOf(row).filter((node) => node.type === 'Text' && typeof node.children?.[0] === 'string')

export const hotkeysOf = async (ui: Mounted): Promise<string[]> => (await ui.findAll({ type: 'Button' })).flatMap((button) => (typeof button.props.hotkey === 'string' ? [button.props.hotkey] : []))
