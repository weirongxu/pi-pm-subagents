import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import { Type } from 'typebox'
import { Parse } from 'typebox/value'

import { renderCoordinatorModeWidget } from '../coordinator/coordinator.js'
import { customSelect } from '../custom-select.js'
import type { PmSubagentState } from '../types.js'
import {
  modelOptionOf,
  parseModelRef,
  resolveModelRef,
} from '../utils/model-ref.js'
import { scopedModelsEditor } from './scoped-models-editor.js'
import {
  MODEL_DEFAULT,
  MODEL_DEFAULT_LABEL,
} from './subagent-model-constants.js'

const PmSubagentsConfigSchema = Type.Object({
  subagentModel: Type.Optional(Type.String()),
  subagentModelScoped: Type.Optional(Type.Array(Type.String())),
  defaultMode: Type.Optional(Type.String()),
})

export function sanitizeConfig(record: PmSubagentsConfig): PmSubagentsConfig {
  const model = record.subagentModel
  const subagentModel = model && !parseModelRef(model) ? undefined : model

  let subagentModelScoped = record.subagentModelScoped
  if (subagentModelScoped) {
    const filtered = subagentModelScoped.filter(
      (ref) => ref === MODEL_DEFAULT || parseModelRef(ref) !== undefined,
    )
    subagentModelScoped = filtered.length > 0 ? filtered : undefined
  }

  const defaultMode =
    record.defaultMode === 'coordinator' ? 'coordinator' : undefined

  return {
    subagentModel,
    subagentModelScoped,
    defaultMode,
  }
}

export type PmSubagentsConfig = Static<typeof PmSubagentsConfigSchema>

let pmSubagentsConfig: PmSubagentsConfig = {}

function configPath(): string {
  return join(getAgentDir(), 'pi-pm-subagents.json')
}

export async function loadPmSubagentsConfig(): Promise<void> {
  try {
    const raw: unknown = JSON.parse(await readFile(configPath(), 'utf8'))
    pmSubagentsConfig = sanitizeConfig(Parse(PmSubagentsConfigSchema, raw))
  } catch {
    pmSubagentsConfig = {}
  }
}

export function getPmSubagentsConfig(): PmSubagentsConfig {
  return pmSubagentsConfig
}

export async function setSubagentModelScoped(scope: string[]): Promise<void> {
  pmSubagentsConfig.subagentModelScoped = scope
  await savePmSubagentsConfig()
}

export async function setSubagentModel(
  model: string | undefined,
): Promise<void> {
  pmSubagentsConfig.subagentModel = model
  await savePmSubagentsConfig()
}

export async function setDefaultMode(
  mode: 'coordinator' | undefined,
): Promise<void> {
  pmSubagentsConfig.defaultMode = mode
  await savePmSubagentsConfig()
}

async function savePmSubagentsConfig(): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(
    configPath(),
    `${JSON.stringify(pmSubagentsConfig, null, 2)}\n`,
    'utf8',
  )
}

async function pickModel(ctx: ExtensionContext): Promise<string | undefined> {
  const items: Array<{ key: string; text: string }> = [
    { key: MODEL_DEFAULT, text: MODEL_DEFAULT_LABEL },
    ...ctx.modelRegistry.getAvailable().map(modelOptionOf),
  ]
  return customSelect(ctx, {
    items,
    title: 'Choose model',
    placeholder: 'filter (provider/id substring)',
  })
}

export function setupPmSubagentsConfig(
  pi: ExtensionAPI,
  state: PmSubagentState,
): void {
  pi.registerCommand('pm-subagent-model', {
    description: 'Configure the subagent model',
    handler: async (_args, ctx) => {
      const model = await pickModel(ctx)
      if (!model) {
        ctx.ui.notify('No model selected', 'warning')
        return
      }

      const isDefaultModel = model === MODEL_DEFAULT
      if (!isDefaultModel && !resolveModelRef(ctx, [model])) {
        ctx.ui.notify(`Unknown model "${model}"`, 'warning')
        return
      }

      await setSubagentModel(isDefaultModel ? undefined : model)
      state.sessionSubagentModel = isDefaultModel ? undefined : model

      const current = pmSubagentsConfig.subagentModel ?? MODEL_DEFAULT
      ctx.ui.notify(`Subagent model: ${current}`, 'info')
      if (state.mode === 'coordinator') renderCoordinatorModeWidget(ctx, state)
    },
  })

  pi.registerCommand('pm-subagent-scoped', {
    description: 'Manage subagent model scope (cycle pool)',
    handler: async (_args, ctx) => {
      const currentDefault = pmSubagentsConfig.subagentModel
      const currentScope =
        pmSubagentsConfig.subagentModelScoped ??
        (currentDefault ? [currentDefault] : [])
      const result = await scopedModelsEditor(ctx, {
        items: [
          { key: MODEL_DEFAULT, text: MODEL_DEFAULT_LABEL, provider: '' },
          ...ctx.modelRegistry.getAvailable().map(modelOptionOf),
        ],
        initialChecked: currentScope,
        title: 'Subagent Model Scope',
      })
      if (result === undefined) {
        ctx.ui.notify('Scope unchanged.', 'info')
        return
      }
      await setSubagentModelScoped(result)
      ctx.ui.notify(`Subagent scope saved (${result.length} items).`, 'info')
      if (state.mode === 'coordinator') renderCoordinatorModeWidget(ctx, state)
    },
  })

  const runPmDefaultCommand = async (_args: string, ctx: ExtensionContext) => {
    const enabled = pmSubagentsConfig.defaultMode !== 'coordinator'
    await setDefaultMode(enabled ? 'coordinator' : undefined)
    ctx.ui.notify(`pm mode on startup: ${enabled ? 'on' : 'off'}`, 'info')
  }

  pi.registerCommand('coordinator-default', {
    description: 'Toggle pm (coordinator) mode enabled by default on startup',
    handler: runPmDefaultCommand,
  })

  pi.registerCommand('pm-default', {
    description: 'Toggle pm (coordinator) mode enabled by default on startup',
    handler: runPmDefaultCommand,
  })
}
