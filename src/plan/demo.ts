import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { renderPlanPager } from './plan.js'

const DEMO_PLAN = `# Refactor the worker pool

The worker pool currently spawns a child process per request. Move to a fixed
worker farm with a job queue to cut startup latency.

## Goals

- Reduce p95 startup under 200ms
- Cap concurrent workers at 8
- Preserve the existing \`WorkerManager\` API

## Non-goals

- Horizontal scaling across machines
- Replacing the JSON-RPC transport

## Approach

1. Add a \`WorkerFarm\` class with a bounded queue
2. Reuse warm processes via a round-robin pool
3. Emit \`worker:reused\` events for telemetry
`

export function setupPlanDemo(pi: ExtensionAPI): void {
  pi.registerCommand('plan-demo', {
    description:
      'Open the plan pager on a sample plan for UI/footer testing. No side effects.',
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify('plan-demo requires a TTY UI.', 'warning')
        return
      }
      const choice = await renderPlanPager(ctx, DEMO_PLAN.repeat(10))
      ctx.ui.notify(
        choice ? `plan-demo: would do "${choice}"` : 'plan-demo: cancelled',
        'info',
      )
    },
  })
}
