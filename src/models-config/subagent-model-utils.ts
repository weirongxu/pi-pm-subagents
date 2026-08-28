import type { Api, Model } from '@earendil-works/pi-ai'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

import { resolveModelRef } from '../utils/model-ref.js'
import { MODEL_DEFAULT } from './subagent-model-constants.js'

export interface CycleResult {
  readonly ref: string
  readonly index: number
  readonly poolSize: number
}

export function cycleSubagentModel(
  scope: readonly string[],
  currentRef: string | undefined,
  direction: 1 | -1,
): CycleResult {
  if (scope.length === 0) {
    throw new Error('subagent model scope must be non-empty')
  }
  const currentIndex = currentRef ? scope.indexOf(currentRef) : -1
  const safeIndex = currentIndex < 0 ? 0 : currentIndex
  const clampedNextIndex =
    (((safeIndex + direction) % scope.length) + scope.length) % scope.length
  return {
    ref: scope[clampedNextIndex] ?? MODEL_DEFAULT,
    index: clampedNextIndex,
    poolSize: scope.length,
  }
}

export function resolveSubagentModelForSpawn(
  ctx: ExtensionContext,
  roleModel: string | undefined,
  sessionModel: string | undefined,
): Model<Api> | undefined {
  const ref = roleModel ?? sessionModel ?? MODEL_DEFAULT
  return resolveModelRef(ctx, [ref]) ?? ctx.model
}

export function formatSubagentModelLabel(
  scope: readonly string[],
  currentRef: string | undefined,
): string {
  if (scope.length === 0) {
    return currentRef ?? MODEL_DEFAULT
  }
  const ref = currentRef ?? MODEL_DEFAULT
  const index = scope.indexOf(ref)
  if (index < 0) return ref
  return `${ref} (${index + 1}/${scope.length})`
}
