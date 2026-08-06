import type { AgentSession } from '@earendil-works/pi-coding-agent'

import type { LiveWorker } from './worker-manager.js'
import { WorkerManager } from './worker-manager.js'

/**
 * DemoWorkerManager inherits WorkerManager so it can be used wherever a
 * WorkerManager is expected (e.g. openWorkerViewer), but backs itself with
 * fake data instead of real agent sessions.
 */
export class DemoWorkerManager extends WorkerManager {
  readonly #workers: LiveWorker[] = initialDemoWorkers()

  override list(): LiveWorker[] {
    return [...this.#workers]
  }

  override get(id: number): LiveWorker | undefined {
    return this.#workers.find((w) => w.id === id)
  }

  override latest(): LiveWorker | undefined {
    return this.#workers[this.#workers.length - 1]
  }

  override spawn(): Promise<LiveWorker> {
    return Promise.reject(new Error('spawn is not supported for demo workers'))
  }

  override steer(): Promise<boolean> {
    return Promise.resolve(false)
  }

  override async abort(id: number): Promise<boolean> {
    const worker = this.get(id)
    if (!worker || worker.status !== 'running') return false
    worker.status = 'stopped'
    worker.completedAt = Date.now()
    worker.summary = '(Worker stopped.)'
    return true
  }

  add(text?: string): void {
    this.#workers.push({
      id: this.#workers.length + 1,
      title: text ?? 'Review and fix authentication flow',
      text: text ?? 'Review and fix authentication flow',
      status: 'running',
      startedAt: Date.now() - 600000,
      completedAt: undefined,
      summary: undefined,
      followUpCount: 0,
      enabledTools: new Set(['read', 'write', 'bash']),
      responseText: undefined,
      session: mockSession(),
    })
  }
}

function initialDemoWorkers(): LiveWorker[] {
  const now = Date.now()
  return [
    {
      id: 1,
      title: 'Review and fix authentication flow',
      text: 'Review and fix authentication flow',
      status: 'done',
      startedAt: now - 3600000,
      completedAt: now - 3000000,
      summary: 'Fixed JWT token validation and updated error handling.',
      followUpCount: 0,
      enabledTools: new Set(['read', 'edit', 'bash']),
      responseText: undefined,
      session: mockSession(),
    },
    {
      id: 2,
      title: 'Add unit tests for API endpoints',
      text: 'Add unit tests for API endpoints',
      status: 'running',
      startedAt: now - 600000,
      completedAt: undefined,
      summary: undefined,
      followUpCount: 0,
      enabledTools: new Set(['read', 'write', 'bash']),
      responseText: undefined,
      session: mockSession(),
    },
    {
      id: 3,
      title: 'Update dependencies and fix breaking changes\nClean local cache',
      text: 'Update dependencies and fix breaking changes\nClean local cache',
      status: 'failed',
      startedAt: now - 1200000,
      completedAt: now - 900000,
      summary: 'Error: Peer dependency conflict with React 19.',
      followUpCount: 2,
      enabledTools: new Set(['read', 'bash']),
      responseText: undefined,
      session: mockSession(),
    },
    {
      id: 4,
      title: 'Optimize database queries for dashboard',
      text: 'Optimize database queries for dashboard',
      status: 'stopped',
      startedAt: now - 1800000,
      completedAt: now - 1500000,
      summary: 'Worker stopped by user.',
      followUpCount: 1,
      enabledTools: new Set(['read', 'edit']),
      responseText: undefined,
      session: mockSession(),
    },
    {
      id: 5,
      title: 'Write documentation for new features',
      text: 'Write documentation for new features',
      status: 'done',
      startedAt: now - 7200000,
      completedAt: now - 6000000,
      summary: 'Updated README and added API reference docs.',
      followUpCount: 0,
      enabledTools: new Set(['read', 'write']),
      responseText: undefined,
      session: mockSession(),
    },
  ]
}

function mockSession(): AgentSession {
  return {
    messages: [],
    dispose: () => {},
    abort: async () => {},
    steer: async () => false,
    subscribe: () => () => {},
    prompt: async () => '',
  } as unknown as AgentSession
}
