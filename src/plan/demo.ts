import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import { buildReviewOptions } from '../subagent/review-utils.js'
import { askHowToProceed } from '../ui/review-pager.js'

export function registerPlanDemoCommand(pi: ExtensionAPI): void {
  pi.registerCommand('plan-demo', {
    description: 'Preview the planner review UI (PI_DEMO)',
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return
      await askHowToProceed(
        ctx,
        buildReviewOptions({
          content: DEMO_PLAN,
          name: 'plan',
          actions: {
            send: () => {
              ctx.ui.notify('Demo: sent to coordinator', 'info')
            },
            revise: (updatePrompt) => {
              ctx.ui.notify(`Demo: followup with: ${updatePrompt}`, 'info')
            },
          },
        }),
      )
    },
  })
}

const DEMO_PLAN = `# Implement distributed task scheduler

## Goal

Add a distributed task scheduler that assigns background jobs across
worker nodes with at-least-once delivery semantics.

## Phase 1: Core data model

- Define \`TaskRecord\` with fields: id, payload, priority, deadline, attempts
- Add a \`task_queue\` table with a partial index on pending rows
- Provide a migration script and rollback path

Example schema:

\`\`\`sql
CREATE TABLE task_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSONB NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  deadline TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX idx_task_queue_pending
  ON task_queue (priority DESC, deadline ASC)
  WHERE status = 'pending';
\`\`\`

## Phase 2: Dispatcher service

1. Poll the queue with \`FOR UPDATE SKIP LOCKED\` in batches of 32
2. Lease each task for 60 seconds; extend if the worker heartbeats
3. Requeue tasks whose lease expires without completion
4. Emit metrics for lease latency and requeue counts

Pseudocode:

\`\`\`ts
async function leaseBatch(worker: Worker, size: number) {
  const rows = await db.tx((tx) =>
    tx.query(
      \`SELECT * FROM task_queue
        WHERE status = 'pending'
        ORDER BY priority DESC, deadline ASC
        LIMIT $1 FOR UPDATE SKIP LOCKED\`,
      [size],
    ),
  )
  return rows.map((row) => toTaskRecord(row))
}
\`\`\`

## Phase 3: Worker protocol

- Workers acknowledge with \`COMPLETE\`, \`RETRY\`, or \`FAIL\`
- Exponential backoff with jitter, capped at 5 minutes
- Poison tasks (attempts > 10) move to a dead-letter table

## Phase 4: Observability

- Dashboard panels: queue depth, oldest pending age, requeue rate
- Structured logs keyed by task id and worker id
- Alert when oldest pending age exceeds 10 minutes

## Testing

- Unit tests for lease/retry state transitions
- Integration test: kill a worker mid-lease, assert task is requeued
- Load test: 10k tasks across 4 workers, no lost work

## Rollout

1. Ship behind the \`distributed_scheduler\` feature flag
2. Enable for internal tenant, monitor for one week
3. Gradual rollout to all tenants, then remove the legacy cron path`
