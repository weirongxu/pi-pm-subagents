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

import { customSelect } from './custom-select.js'
import {
  modelRefOf,
  parseModelRef,
  resolveModelRef,
} from './utils/model-ref.js'

export const MODEL_DEFAULT = 'DEFAULT'

const PiModesConfigSchema = Type.Object({
  subagentDefaultModel: Type.Optional(Type.String()),
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
    const model = record.subagentDefaultModel
    if (model !== undefined && !parseModelRef(model))
      record.subagentDefaultModel = undefined
    piModesConfig = record
  } catch {
    piModesConfig = {}
  }
}

export function getPiModesConfig(): PiModesConfig {
  return piModesConfig
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
  const items = [
    { key: MODEL_DEFAULT, text: 'DEFAULT (use agent default)' },
    ...ctx.modelRegistry.getAvailable().map((m) => ({
      key: modelRefOf(m),
      text: `${m.provider}/${m.name}`,
    })),
  ]
  return customSelect(ctx, {
    items,
    title: 'Choose model',
    placeholder: 'filter (provider/id substring)',
  })
}

export function setupModesConfig(pi: ExtensionAPI): void {
  pi.registerCommand('modes-subagent-model', {
    description: 'Configure the default model for subagents',
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

      if (isDefaultModel) piModesConfig.subagentDefaultModel = undefined
      else piModesConfig.subagentDefaultModel = model
      await savePiModesConfig()

      showModelsConfig(ctx)
    },
  })
}

function showModelsConfig(ctx: ExtensionContext): void {
  const model = piModesConfig.subagentDefaultModel
  if (model === undefined) {
    ctx.ui.notify('Subagent: DEFAULT', 'info')
  } else {
    ctx.ui.notify(`Subagent: ${model}`, 'info')
  }
}
