import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'

import { BASH_READONLY_TOOL_NAME } from './bash-readonly.js'
import type { ModesState, ModeType } from './types.js'
import type { PromptDefinition } from './utils/markdown.js'
import { modelRefOf, resolveModelRef } from './utils/model-ref.js'
import { persist } from './utils/state.js'
import { composeTools, type ToolConfig } from './utils/tools.js'

export type { ToolConfig } from './utils/tools.js'

/** Restore the model captured before entering a read-only mode. */
export async function restoreModel(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  const previousModel = state.previousModel
  state.previousModel = undefined
  if (!previousModel) return

  const currentModel = ctx.model
  if (currentModel) {
    const currentRef = `${currentModel.provider}/${currentModel.id}`
    if (currentRef === previousModel) return
  }

  const model = resolveModelRef(ctx, [previousModel])
  if (model) await pi.setModel(model)
}

export function baseToolsOf(pi: ExtensionAPI, state: ModesState): string[] {
  const diff = state.modeDiffTools
  if (!diff) return pi.getActiveTools()
  const current = pi.getActiveTools()
  const added = new Set(diff.added)
  const merged = [...new Set([...current, ...diff.removed])]
  return merged.filter((name) => !added.has(name))
}

export function restoreTools(pi: ExtensionAPI, state: ModesState): void {
  pi.setActiveTools(baseToolsOf(pi, state))
  state.modeDiffTools = undefined
}

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

export function calculateModeTools(
  pi: ExtensionAPI,
  state: ModesState,
  config: ToolConfig = {},
): string[] {
  const base = pi.getActiveTools()
  const applied = composeTools(base, config)
    .filter((name) => !WRITE_TOOLS.has(name))
    .map((name) => BASH_REPLACEMENT.get(name) ?? name)

  if (!state.modeDiffTools) {
    state.modeDiffTools = {
      added: applied.filter((name) => !base.includes(name)),
      removed: base.filter((name) => !applied.includes(name)),
    }
  }
  return applied
}

export async function exitModeFor(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  name: ModeType,
): Promise<void> {
  restoreTools(pi, state)
  await restoreModel(pi, state, ctx)
  ctx.ui.setStatus(name, undefined)
  persist(pi, state)
}

export async function applyModeModel(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
  modelRef: string | undefined,
): Promise<void> {
  if (!modelRef) return

  const model = resolveModelRef(ctx, [modelRef])
  if (!model) {
    ctx.ui.notify(`Invalid model ref: ${modelRef}`, 'warning')
    return
  }

  if (!state.previousModel) {
    const current = ctx.model
    if (current) state.previousModel = modelRefOf(current)
  }

  const success = await pi.setModel(model)
  if (!success) {
    ctx.ui.notify('No API key for this model', 'error')
    state.previousModel = undefined
  }
}

export interface ModeSetupOptions {
  /** The mode's prompt definition. Used to derive the active tool set. */
  promptDefinition: PromptDefinition
  /** Theme color role used for the mode's status indicator. */
  color: ThemeColor
}

export async function applyModeFor(
  pi: ExtensionAPI,
  state: ModesState,
  modeType: ModeType,
  ctx: ExtensionContext,
  options: ModeSetupOptions,
): Promise<void> {
  pi.setActiveTools(calculateModeTools(pi, state, options.promptDefinition.fm))
  await applyModeModel(pi, state, ctx, options.promptDefinition.fm.model)
  ctx.ui.setStatus(modeType, ctx.ui.theme.fg(options.color, modeType))
  persist(pi, state)
}
