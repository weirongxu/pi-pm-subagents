import type { Api, Model } from '@earendil-works/pi-ai'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

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
  ref: readonly (string | undefined)[],
): Model<Api> | undefined {
  for (const r of ref) {
    if (!r) continue
    const parsed = parseModelRef(r)
    if (!parsed) continue
    const model = ctx.modelRegistry.find(parsed.provider, parsed.id)
    if (model) return model
  }
  return undefined
}
