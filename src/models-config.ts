import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { Api, Model } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Parse } from 'typebox/value'

import type { ModesState } from './helper.js'
import type { ModeRole } from './types.js'

export const MODES_ROLES: readonly ModeRole[] = ['plan', 'manager', 'worker']

export type ModelsConfig = Partial<Record<ModeRole, string>>

const MODEL_DEFAULT = 'DEFAULT'

/** Schema for `<agentDir>/modes-models.json`: optional ref per role. */
const ModelsConfigSchema = Type.Object({
  plan: Type.Optional(Type.String()),
  manager: Type.Optional(Type.String()),
  worker: Type.Optional(Type.String()),
})

let modelsConfig: ModelsConfig = {}

function configPath(): string {
  return join(getAgentDir(), 'modes-models.json')
}

/** Read `<agentDir>/modes-models.json` into the module cache. */
export async function loadModelsConfig(): Promise<void> {
  try {
    const raw: unknown = JSON.parse(await readFile(configPath(), 'utf8'))
    const record = Parse(ModelsConfigSchema, raw)
    for (const role of MODES_ROLES) {
      const model = record[role]
      if (model !== undefined && !parseModelRef(model)) record[role] = undefined
    }
    modelsConfig = record
  } catch {
    modelsConfig = {}
  }
}

export function getModelsConfig(): ModelsConfig {
  return modelsConfig
}

async function saveModelsConfig(): Promise<void> {
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(
    configPath(),
    `${JSON.stringify(modelsConfig, null, 2)}\n`,
    'utf8',
  )
}

export function modelRefOf(model: Model<Api>): string {
  return `${model.provider}/${model.id}`
}

export function parseModelRef(
  ref: string,
): { provider: string; id: string } | undefined {
  const [provider, id] = ref.split('/')
  if (!provider || !id) return undefined
  return { provider, id }
}

export function resolveModelRef(
  ctx: ExtensionContext,
  ref: string,
): Model<Api> | undefined {
  const parsed = parseModelRef(ref)
  if (!parsed) return undefined
  return ctx.modelRegistry.find(parsed.provider, parsed.id)
}

function isRole(value: string): value is ModeRole {
  return (MODES_ROLES as readonly string[]).includes(value)
}

async function pickModel(ctx: ExtensionContext): Promise<string | undefined> {
  const models = ctx.modelRegistry.getAvailable()
  const options = [MODEL_DEFAULT, ...models.map((m) => modelRefOf(m))]
  return await ctx.ui.select('Choose model', options)
}

export async function switchToRoleModel(
  pi: ExtensionAPI,
  state: ModesState,
  role: ModeRole,
  ctx: ExtensionContext,
): Promise<void> {
  const ref = modelsConfig[role]
  if (!ref) return
  if (ctx.model && modelRefOf(ctx.model) === ref) return
  if (!state.modelBackup && ctx.model) state.modelBackup = modelRefOf(ctx.model)
  const model = resolveModelRef(ctx, ref)
  if (!model) {
    ctx.ui.notify(`Unknown model "${ref}" for ${role} role`, 'warning')
    return
  }
  const ok = await pi.setModel(model)
  if (!ok)
    ctx.ui.notify(`Could not switch to ${ref} (missing API key?)`, 'warning')
}

/** Restore the main-session model captured before the last role switch. */
export async function restoreMainModel(
  pi: ExtensionAPI,
  state: ModesState,
  ctx: ExtensionContext,
): Promise<void> {
  const ref = state.modelBackup
  if (!ref) return
  state.modelBackup = undefined
  const model = resolveModelRef(ctx, ref)
  if (model) await pi.setModel(model)
}

/** Register the `/modes-model` command (role model configuration). */
export function setupModesConfig(pi: ExtensionAPI, state: ModesState): void {
  pi.registerCommand('modes-model', {
    description:
      'Configure the model. Usage: /modes-model <plan|manager|worker>',
    getArgumentCompletions: (prefix: string) => {
      const items = [...MODES_ROLES]
        .filter((candidate) => candidate.startsWith(prefix))
        .map((candidate) => ({ value: candidate, label: candidate }))
      return items.length > 0 ? items : null
    },
    handler: async (args, ctx) => {
      await runModelsConfigCommand(pi, state, args, ctx)
    },
  })
}

function showModelsConfig(ctx: ExtensionContext): void {
  const items: string[] = []
  for (const role of MODES_ROLES) {
    const model = modelsConfig[role]
    if (model === undefined) continue
    items.push(`${role}: ${model}`)
  }
  ctx.ui.notify(items.join('\n'), 'info')
}

/** `/modes-model` command: view/set/clear a role's model. */
async function runModelsConfigCommand(
  pi: ExtensionAPI,
  state: ModesState,
  args: string,
  ctx: ExtensionContext,
): Promise<void> {
  const roleArg = args
  const getRole = async (arg: string | undefined): Promise<ModeRole | null> => {
    if (arg) {
      if (isRole(arg)) return arg
      else {
        ctx.ui.notify(`Invalid role ${arg}`, 'warning')
        return null
      }
    } else {
      const rolePicked = await ctx.ui.select('Select role to configure', [
        ...MODES_ROLES,
      ])
      if (!rolePicked || !isRole(rolePicked)) return null
      return rolePicked
    }
  }
  const getModel = async (): Promise<string | null> => {
    const modelPicked = await pickModel(ctx)
    if (modelPicked === undefined) {
      ctx.ui.notify('No model selected', 'warning')
      return null
    }
    return modelPicked
  }

  const role = await getRole(roleArg)
  const model = await getModel()
  if (!role || !model) return

  const isDefaultModel = model === MODEL_DEFAULT
  if (!isDefaultModel && !resolveModelRef(ctx, model)) {
    ctx.ui.notify(`Unknown model "${model}"`, 'warning')
    return
  }

  if (isDefaultModel) modelsConfig[role] = undefined
  else modelsConfig[role] = model
  await saveModelsConfig()

  showModelsConfig(ctx)

  if (role === state.mode) {
    await switchToRoleModel(pi, state, role, ctx)
  }
}
