import type { Api, Model } from '@earendil-works/pi-ai'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

import { MODEL_DEFAULT } from '../models-config/subagent-model-constants.js'

export interface ModelOption {
  key: string
  text: string
  provider: string
}

export function modelRefOf(model: Model<Api>): string {
  return `${model.provider}/${model.id}`
}

export function modelOptionOf(model: Model<Api>): ModelOption {
  return {
    key: modelRefOf(model),
    text: `${model.provider}/${model.name}`,
    provider: model.provider,
  }
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
  ref: readonly (string | undefined)[],
): Model<Api> | undefined {
  for (const r of ref) {
    if (!r || r === MODEL_DEFAULT) continue
    const parsed = parseModelRef(r)
    if (!parsed) continue
    const model = ctx.modelRegistry.find(parsed.provider, parsed.id)
    if (model) return model
  }
  return undefined
}
