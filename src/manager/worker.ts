import { fileURLToPath } from 'node:url'

import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { truncateToWidth } from '@earendil-works/pi-tui'

import { formatElapsed, lastMessageText, messageText } from '../helper.js'

const SELF_DIR = fileURLToPath(new URL('../', import.meta.url))

/** Cap worker output so it cannot overwhelm the manager's context. */
const MAX_WORKER_OUTPUT_BYTES = 50 * 1024

/** Max follow-up tasks per worker before requiring a fresh worker. */
export const MAX_REUSE_FOLLOWUPS = 5
export const MAX_CONCURRENCY_WORKER = 5

/** Worker status values:
 * - running: Worker is actively executing a task
 * - done: Worker finished naturally (completed task successfully)
 * - stopped: User manually aborted the worker via abort() method
 * - failed: Worker encountered an error during execution
 */
export type WorkerStatus = 'running' | 'done' | 'failed' | 'stopped'

export interface SpawnOptions {
  cwd: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  /**
   * Tools enabled in the worker session. Inherits the user's startup tool set
   * (captured as `toolsBackup` before entering a read-only mode) so the worker
   * gets full tool access — including other extensions' tools — instead of a
   * hardcoded subset.
   */
  tools?: readonly string[]
  /** Worker system prompt (loaded from prompts/worker.md). */
  systemPrompt?: string
  /** Id of the worker this delegation follows up (correction/continuation of its work). */
  followupOf?: number
}

/**
 * A live, in-memory worker. The session stays alive while running and for
 * viewing afterwards; it is never persisted (sessions can't be resumed across
 * processes, and a resumed manager simply drives new workers).
 */
export interface LiveWorker {
  id: number
  title: string
  text: string
  status: WorkerStatus
  session: AgentSession
  startedAt: number
  completedAt?: number
  message?: string
  /** Number of follow-up tasks executed on this worker. */
  followUpCount: number
  /** Tool names enabled for this worker (from session configuration). */
  enabledTools: Set<string>
  /** Latest streaming assistant narration (live widget activity). */
  responseText?: string
}

export interface WorkerManagerOptions {
  /** Fired on spawn / completion / status change (re-render the widget + fleet). */
  onStatusChange?: () => void
  /** Fired once when a worker enters running state. */
  onStart?: (worker: LiveWorker) => void
  /** Fired once when a worker exits running state (done/failed/stopped/disposed). */
  onEnd?: (worker: LiveWorker) => void
}

/** Plain-text one-line summary of a worker: `status #id title(elided) elapsed`. */
export function formatWorkerSummary(
  worker: LiveWorker,
  titleWidth = 30,
): string {
  return `${worker.status} #${worker.id} ${truncateToWidth(worker.title, titleWidth)} follow-up(${worker.followUpCount}) ${formatElapsed(worker)}`
}

export class WorkerManager {
  private workers = new Map<number, LiveWorker>()
  private seq = 0

  constructor(private options: WorkerManagerOptions = {}) {}

  private countRunning(): number {
    return [...this.workers.values()].filter(
      (worker) => worker.status === 'running',
    ).length
  }

  list(): LiveWorker[] {
    return [...this.workers.values()]
  }

  get(id: number): LiveWorker | undefined {
    return this.workers.get(id)
  }

  latest(): LiveWorker | undefined {
    let latest: LiveWorker | undefined
    for (const worker of this.workers.values()) {
      if (!latest || worker.id > latest.id) latest = worker
    }
    return latest
  }

  async spawn(
    title: string,
    task: string,
    options: SpawnOptions,
  ): Promise<LiveWorker> {
    if (options.followupOf) {
      return this.handleFollowup(title, task, options.followupOf)
    }
    return this.createNewWorker(title, task, options)
  }

  private async handleFollowup(
    title: string,
    task: string,
    followupOf: number,
  ): Promise<LiveWorker> {
    const followupWorker = this.workers.get(followupOf)
    if (!followupWorker) throw new Error(`Worker #${followupOf} not found`)
    if (followupWorker.status === 'running')
      throw new Error(
        `Cannot follow-up worker #${followupOf} while it is still running`,
      )
    if (followupWorker.followUpCount >= MAX_REUSE_FOLLOWUPS)
      throw new Error(
        `Worker #${followupOf} follow-up budget exhausted (${MAX_REUSE_FOLLOWUPS}/${MAX_REUSE_FOLLOWUPS}). Start a fresh worker instead.`,
      )

    followupWorker.title = title
    followupWorker.text = task
    followupWorker.status = 'running'
    followupWorker.startedAt = Date.now()
    followupWorker.completedAt = undefined
    followupWorker.message = undefined
    followupWorker.followUpCount += 1
    this.options.onStatusChange?.()
    this.options.onStart?.(followupWorker)
    void this.run(followupWorker, task)
    return followupWorker
  }

  private async createLoader(
    options: SpawnOptions,
  ): Promise<DefaultResourceLoader> {
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: (base) => `${base}\n\n${options.systemPrompt}`,
      extensionsOverride: (base) => ({
        ...base,
        extensions: base.extensions.filter(
          (extension) => !extension.resolvedPath.startsWith(SELF_DIR),
        ),
      }),
    })
    await loader.reload()
    return loader
  }

  private async createNewWorker(
    title: string,
    task: string,
    options: SpawnOptions,
  ): Promise<LiveWorker> {
    if (this.countRunning() >= MAX_CONCURRENCY_WORKER) {
      throw new Error(
        `Worker concurrency limit reached (${MAX_CONCURRENCY_WORKER}). Wait for an existing worker to finish, or abort one.`,
      )
    }
    const loader = await this.createLoader(options)
    const created = await createAgentSession({
      cwd: options.cwd,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      tools: options.tools ? [...options.tools] : undefined,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(options.cwd),
    })

    this.seq += 1
    const id = this.seq
    const enabledTools: Set<string> = options.tools
      ? new Set(options.tools)
      : new Set()
    const worker: LiveWorker = {
      id,
      title,
      text: task,
      status: 'running',
      session: created.session,
      startedAt: Date.now(),
      followUpCount: 0,
      enabledTools,
    }

    this.workers.set(id, worker)
    this.subscribe(worker)
    this.options.onStart?.(worker)
    this.options.onStatusChange?.()
    void this.run(worker, task)
    return worker
  }

  async steer(id: number, text: string): Promise<boolean> {
    const worker = this.workers.get(id)
    if (!worker || worker.status !== 'running') return false
    await worker.session.steer(text)
    return true
  }

  async abort(id: number): Promise<boolean> {
    const worker = this.workers.get(id)
    if (!worker || worker.status !== 'running') return false
    worker.status = 'stopped'
    worker.message = '(Worker stopped.)'
    this.options.onStatusChange?.()
    await worker.session.abort()
    return true
  }

  disposeAll(): void {
    const disposedSessions = new Set<AgentSession>()
    for (const worker of this.workers.values()) {
      if (worker.status === 'running') {
        worker.status = 'stopped'
        worker.message = '(Worker disposed.)'
        this.options.onEnd?.(worker)
      }
      if (!disposedSessions.has(worker.session)) {
        worker.session.dispose()
        disposedSessions.add(worker.session)
      }
    }
    this.workers.clear()
  }

  private subscribe(worker: LiveWorker): void {
    worker.session.subscribe((event) => {
      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent.type === 'text_delta') {
            worker.responseText = messageText(event.message)
          }
          break
        default:
          break
      }
    })
  }

  private async run(worker: LiveWorker, task: string): Promise<void> {
    try {
      await worker.session.prompt(`Task: ${task}`)
      const lastMessage = lastMessageText(
        worker.session.messages,
        MAX_WORKER_OUTPUT_BYTES,
      )
      if (!lastMessage) {
        worker.message = '(Worker finished without a final message.)'
      } else {
        worker.message = lastMessage
      }
      if (worker.status === 'running') worker.status = 'done'
    } catch (error) {
      // Aborted workers are already marked 'stopped' with their own last message.
      if (worker.status === 'running') {
        worker.message = error instanceof Error ? error.message : String(error)
        worker.status = 'failed'
      }
    } finally {
      worker.completedAt = Date.now()
      worker.responseText = undefined
      this.options.onStatusChange?.()
      this.options.onEnd?.(worker)
    }
  }
}
