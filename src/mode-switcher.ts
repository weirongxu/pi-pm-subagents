import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'

import {
  type ModesState,
  persist,
  restoreTools,
  WRITE_TOOLS,
} from './helper.js'
import { restoreMainModel, switchToRoleModel } from './models-config.js'
import type { ModeUserType } from './types.js'

export function assertModeIdle(
  state: ModesState,
  entering: ModeUserType,
): void {
  if (state.mode !== undefined) {
    throw new Error(
      `Cannot enter ${entering} mode while in ${state.mode} mode — exit the current mode first.`,
    )
  }
}

export function readOnlyToolSet(
  active: readonly string[],
  extra: readonly string[] = [],
): string[] {
  const filtered = active.filter((name) => !WRITE_TOOLS.has(name))
  return [...new Set([...filtered, ...extra])]
}

export function enterReadOnly(
  pi: ExtensionAPI,
  state: ModesState,
  extra: readonly string[] = [],
): void {
  if (!state.toolsBackup) state.toolsBackup = pi.getActiveTools()
  pi.setActiveTools(readOnlyToolSet(state.toolsBackup, extra))
}

export async function exitReadOnly(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  name: ModeUserType,
  options: { restoreModel?: boolean } = {},
): Promise<void> {
  restoreTools(pi, state)
  if (options.restoreModel) await restoreMainModel(pi, state, ctx)
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
  mode: ModeUserType,
  ctx: ExtensionContext,
  options: ModeSetupOptions,
): Promise<void> {
  enterReadOnly(pi, state, options.extraTools ?? [])
  await switchToRoleModel(pi, state, mode, ctx)
  ctx.ui.setStatus(mode, ctx.ui.theme.fg(options.color, mode))
}
