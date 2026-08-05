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

import { lastAssistantText, messageText } from './helper.js'

const SELF_DIR = fileURLToPath(new URL('../', import.meta.url))

/** Cap worker output so it cannot overwhelm the manager's context. */
const MAX_WORKER_OUTPUT_BYTES = 50 * 1024

/** Max follow-up tasks per worker before requiring a fresh worker. */
export const MAX_FOLLOWUPS = 5

// TODO: REVIEW

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
  text: string
  status: WorkerStatus
  session: AgentSession
  startedAt: number
  completedAt?: number
  summary?: string
  /** Number of follow-up tasks executed on this worker. */
  followUpCount: number
  /** Tool names enabled for this worker (from session configuration). */
  enabledTools: Set<string>
  /** Tool names with an in-flight execution (live widget activity). */
  activeTools: Set<string>
  /** Latest streaming assistant narration (live widget activity). */
  responseText?: string
}

export interface WorkerManagerOptions {
  /** Fired on spawn / completion / status change (re-render the widget + fleet). */
  onStatusChange?: () => void
  /** Fired once when a worker finishes (the manager turns this into a followUp). */
  onDone?: (worker: LiveWorker) => void
}

export class WorkerManager {
  private workers = new Map<number, LiveWorker>()
  private seq = 0

  constructor(private options: WorkerManagerOptions = {}) {}

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

  async spawn(task: string, options: SpawnOptions): Promise<LiveWorker> {
    if (options.followupOf != null) {
      return this.handleFollowup(task, options.followupOf)
    }
    return this.createNewWorker(task, options)
  }

  private async handleFollowup(
    task: string,
    followupOf: number,
  ): Promise<LiveWorker> {
    const followupWorker = this.workers.get(followupOf)
    if (!followupWorker) {
      throw new Error(`Parent worker #${followupOf} not found`)
    }
    if (followupWorker.status === 'running') {
      throw new Error(
        `Cannot follow-up worker #${followupOf} while it is still running`,
      )
    }
    if (followupWorker.followUpCount >= MAX_FOLLOWUPS) {
      throw new Error(
        `Worker #${followupOf} follow-up budget exhausted (${MAX_FOLLOWUPS}/${MAX_FOLLOWUPS}). Start a fresh worker instead.`,
      )
    }

    followupWorker.text = task
    followupWorker.status = 'running'
    followupWorker.startedAt = Date.now()
    followupWorker.completedAt = undefined
    followupWorker.summary = undefined
    followupWorker.followUpCount += 1
    this.options.onStatusChange?.()
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
    task: string,
    options: SpawnOptions,
  ): Promise<LiveWorker> {
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
      text: task,
      status: 'running',
      session: created.session,
      startedAt: Date.now(),
      followUpCount: 0,
      enabledTools,
      activeTools: new Set<string>(),
    }

    this.workers.set(id, worker)
    this.subscribe(worker)
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
    worker.summary = '(Worker stopped.)'
    this.options.onStatusChange?.()
    await worker.session.abort()
    return true
  }

  disposeAll(): void {
    const disposedSessions = new Set<AgentSession>()
    for (const worker of this.workers.values()) {
      worker.activeTools.clear()
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
        case 'tool_execution_start':
          worker.activeTools.add(event.toolName)
          break
        case 'tool_execution_end':
          worker.activeTools.delete(event.toolName)
          break
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
      const summary = lastAssistantText(worker.session.messages)
      if (!summary) {
        worker.summary =
          '(Worker finished without a final summary. Verify the result with read-only tools.)'
      } else if (Buffer.byteLength(summary, 'utf8') > MAX_WORKER_OUTPUT_BYTES) {
        worker.summary = `${summary.slice(0, MAX_WORKER_OUTPUT_BYTES)}\n\n[Output truncated. Verify remaining details with read-only tools.]`
      } else {
        worker.summary = summary
      }
      if (worker.status === 'running') worker.status = 'done'
    } catch (error) {
      // Aborted workers are already marked 'stopped' with their own summary.
      if (worker.status === 'running') {
        worker.summary = error instanceof Error ? error.message : String(error)
        worker.status = 'failed'
      }
    } finally {
      worker.completedAt = Date.now()
      worker.responseText = undefined
      worker.activeTools.clear()
      this.options.onStatusChange?.()
      this.options.onDone?.(worker)
    }
  }
}
