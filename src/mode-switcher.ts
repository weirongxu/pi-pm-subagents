import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'

import { BASH_READONLY_TOOL_NAME } from './bash-readonly.js'
import { persist, restoreTools } from './helper.js'
import {
  composeTools,
  type PromptDefinition,
  type ToolConfig,
} from './prompts/core.js'
import type { ModesState, ModeType } from './types.js'

export type { ToolConfig } from './prompts/core.js'

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

export function applyModeTools(
  base: readonly string[],
  config: ToolConfig,
): string[] {
  const composed = composeTools(base, config)
  return composed
    .filter((name) => !WRITE_TOOLS.has(name))
    .map((name) => BASH_REPLACEMENT.get(name) ?? name)
}

export function enterReadOnly(
  pi: ExtensionAPI,
  state: ModesState,
  config: ToolConfig = {},
): void {
  if (!state.previousActiveTools)
    state.previousActiveTools = pi.getActiveTools()
  pi.setActiveTools(applyModeTools(state.previousActiveTools, config))
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
  /** The mode's prompt definition. Used to derive the active tool set. */
  promptDefinition: PromptDefinition
  /** Theme color role used for the mode's status indicator. */
  color: ThemeColor
}

export async function applyModeSetup(
  pi: ExtensionAPI,
  state: ModesState,
  modeType: ModeType,
  ctx: ExtensionContext,
  options: ModeSetupOptions,
): Promise<void> {
  enterReadOnly(pi, state, {
    tools: options.promptDefinition.tools,
    extraTools: options.promptDefinition.extraTools,
    removeTools: options.promptDefinition.removeTools,
  })
  ctx.ui.setStatus(modeType, ctx.ui.theme.fg(options.color, modeType))
}
