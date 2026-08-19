import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'

import { BASH_READONLY_TOOL_NAME } from './bash-readonly.js'
import { persist, restoreTools } from './helper.js'
import type { ModesState, ModeType } from './types.js'

export function assertModeIdle(state: ModesState, entering: ModeType): void {
  if (state.mode !== undefined) {
    throw new Error(
      `Cannot enter ${entering} mode while in ${state.mode} mode — exit the current mode first.`,
    )
  }
}

export const WRITE_TOOLS = new Set(['edit', 'write'])

const BASH_REPLACEMENT: ReadonlyMap<string, string> = new Map([
  ['bash', BASH_READONLY_TOOL_NAME],
])

export function readOnlyToolSet(
  active: readonly string[],
  extra: readonly string[] = [],
): string[] {
  const transformed = active
    .filter((name) => !WRITE_TOOLS.has(name))
    .map((name) => BASH_REPLACEMENT.get(name) ?? name)
  return [...new Set([...transformed, ...extra])]
}

export function enterReadOnly(
  pi: ExtensionAPI,
  state: ModesState,
  extra: readonly string[] = [],
): void {
  if (!state.previousActiveTools)
    state.previousActiveTools = pi.getActiveTools()
  pi.setActiveTools(readOnlyToolSet(state.previousActiveTools, extra))
}

export async function exitReadOnly(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  name: ModeType,
): Promise<void> {
  restoreTools(pi, state)
  ctx.ui.setStatus(name, undefined)
  persist(pi, state)
}

export interface ModeSetupOptions {
  /** Extra tools to keep alongside the read-only set (e.g. the delegate tool). */
  extraTools?: readonly string[]
  /** Theme color role used for the mode's status indicator. */
  color: ThemeColor
}

export async function applyModeSetup(
  pi: ExtensionAPI,
  state: ModesState,
  mode: ModeType,
  ctx: ExtensionContext,
  options: ModeSetupOptions,
): Promise<void> {
  enterReadOnly(pi, state, options.extraTools ?? [])
  ctx.ui.setStatus(mode, ctx.ui.theme.fg(options.color, mode))
}
