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

import { renderCoordinatorModeWidget } from '../coordinator/index.js'
import { customSelect } from '../custom-select.js'
import type { ModesState } from '../types.js'
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

const PiModesConfigSchema = Type.Object({
  subagentModel: Type.Optional(Type.String()),
  subagentModelScoped: Type.Optional(Type.Array(Type.String())),
})

export type PiModesConfig = Static<typeof PiModesConfigSchema>

let piModesConfig: PiModesConfig = {}

function configPath(): string {
  return join(getAgentDir(), 'pi-modes.json')
}

export async function loadPiModesConfig(): Promise<void> {
  try {
    const raw: unknown = JSON.parse(await readFile(configPath(), 'utf8'))
    const record = Parse(PiModesConfigSchema, raw)
    const model = record.subagentModel
    if (model && !parseModelRef(model)) {
      record.subagentModel = undefined
    }

    if (record.subagentModelScoped) {
      record.subagentModelScoped = record.subagentModelScoped.filter(
        (ref) => ref === MODEL_DEFAULT || parseModelRef(ref) !== undefined,
      )
      if (!record.subagentModelScoped.length)
        record.subagentModelScoped = undefined
    }

    piModesConfig = record
  } catch {
    piModesConfig = {}
  }
}

export function getPiModesConfig(): PiModesConfig {
  return piModesConfig
}

export async function setSubagentModelScoped(scope: string[]): Promise<void> {
  piModesConfig.subagentModelScoped = scope
  await savePiModesConfig()
}

export async function setSubagentModel(
  model: string | undefined,
): Promise<void> {
  piModesConfig.subagentModel = model
  await savePiModesConfig()
}

async function savePiModesConfig(): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(
    configPath(),
    `${JSON.stringify(piModesConfig, null, 2)}\n`,
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

export function setupModesConfig(pi: ExtensionAPI, state: ModesState): void {
  pi.registerCommand('modes-subagent-model', {
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

      const current = piModesConfig.subagentModel ?? MODEL_DEFAULT
      ctx.ui.notify(`Subagent model: ${current}`, 'info')
      if (state.mode === 'coordinator') renderCoordinatorModeWidget(ctx, state)
    },
  })

  pi.registerCommand('modes-subagent-scoped', {
    description: 'Manage subagent model scope (cycle pool)',
    handler: async (_args, ctx) => {
      const currentDefault = piModesConfig.subagentModel
      const currentScope =
        piModesConfig.subagentModelScoped ??
        (currentDefault ? [currentDefault] : [])
      const checked = new Set(currentScope)
      const result = await scopedModelsEditor(ctx, {
        items: [
          { key: MODEL_DEFAULT, text: MODEL_DEFAULT_LABEL },
          ...ctx.modelRegistry.getAvailable().map(modelOptionOf),
        ],
        initialChecked: checked,
        title: 'Subagent Model Scope',
      })
      if (result === undefined) {
        ctx.ui.notify('Scope unchanged.', 'info')
        return
      }
      await setSubagentModelScoped([...result])
      ctx.ui.notify(`Subagent scope saved (${result.size} items).`, 'info')
      if (state.mode === 'coordinator') renderCoordinatorModeWidget(ctx, state)
    },
  })
}
