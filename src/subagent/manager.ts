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

import { formatElapsed, lastMessageText, messageText } from '../helper.js'

const SELF_DIR = fileURLToPath(new URL('../', import.meta.url))

const MAX_SUBAGENT_OUTPUT_BYTES = 50 * 1024

export const MAX_REUSE_FOLLOWUPS = 5
export const MAX_CONCURRENCY_SUBAGENT = 5

export type SubagentStatus = 'running' | 'done' | 'failed' | 'killed'

export interface SpawnOptions {
  cwd: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  tools?: readonly string[]
  systemPrompt?: string
  followupOf?: number
}

export interface LiveSubagent {
  id: number
  title: string
  text: string
  status: SubagentStatus
  session: AgentSession
  startedAt: number
  completedAt?: number
  message?: string
  followUpCount: number
  enabledTools: Set<string>
  responseText?: string
}

export interface SubagentManagerOptions {
  onStatusChange?: () => void
  onStart?: (subagent: LiveSubagent) => void
  onEnd?: (subagent: LiveSubagent) => void
}

export function formatSubagentSummary(
  subagent: LiveSubagent,
  titleWidth = 80,
): string {
  return [
    subagent.status,
    `#${subagent.id}`,
    subagent.title.slice(0, titleWidth),
    `F(${subagent.followUpCount})}`,
    formatElapsed(subagent),
  ].join(' ')
}

export class SubagentManager {
  private subagents = new Map<number, LiveSubagent>()
  private seq = 0

  constructor(private options: SubagentManagerOptions = {}) {}

  private countRunning(): number {
    return [...this.subagents.values()].filter(
      (subagent) => subagent.status === 'running',
    ).length
  }

  list(): LiveSubagent[] {
    return [...this.subagents.values()]
  }

  get(id: number): LiveSubagent | undefined {
    return this.subagents.get(id)
  }

  latest(): LiveSubagent | undefined {
    let latest: LiveSubagent | undefined
    for (const subagent of this.subagents.values()) {
      if (!latest || subagent.id > latest.id) latest = subagent
    }
    return latest
  }

  async spawn(
    title: string,
    task: string,
    options: SpawnOptions,
  ): Promise<LiveSubagent> {
    if (options.followupOf) {
      return this.handleFollowup(title, task, options.followupOf)
    }
    return this.createNewSubagent(title, task, options)
  }

  private async handleFollowup(
    title: string,
    task: string,
    followupOf: number,
  ): Promise<LiveSubagent> {
    const followupSubagent = this.subagents.get(followupOf)
    if (!followupSubagent) throw new Error(`Subagent #${followupOf} not found`)
    if (followupSubagent.status === 'running')
      throw new Error(
        `Cannot follow-up subagent #${followupOf} while it is still running`,
      )
    if (followupSubagent.followUpCount >= MAX_REUSE_FOLLOWUPS)
      throw new Error(
        `Subagent #${followupOf} follow-up budget exhausted (${MAX_REUSE_FOLLOWUPS}/${MAX_REUSE_FOLLOWUPS}). Start a fresh subagent instead.`,
      )

    followupSubagent.title = title
    followupSubagent.text = task
    followupSubagent.status = 'running'
    followupSubagent.startedAt = Date.now()
    followupSubagent.completedAt = undefined
    followupSubagent.message = undefined
    followupSubagent.followUpCount += 1
    this.options.onStatusChange?.()
    this.options.onStart?.(followupSubagent)
    void this.run(followupSubagent, task)
    return followupSubagent
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

  private async createNewSubagent(
    title: string,
    task: string,
    options: SpawnOptions,
  ): Promise<LiveSubagent> {
    if (this.countRunning() >= MAX_CONCURRENCY_SUBAGENT) {
      throw new Error(
        `Subagent concurrency limit reached (${MAX_CONCURRENCY_SUBAGENT}). Wait for an existing subagent to finish, or abort one.`,
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
    const subagent: LiveSubagent = {
      id,
      title,
      text: task,
      status: 'running',
      session: created.session,
      startedAt: Date.now(),
      followUpCount: 0,
      enabledTools,
    }

    this.subagents.set(id, subagent)
    this.subscribe(subagent)
    this.options.onStart?.(subagent)
    this.options.onStatusChange?.()
    void this.run(subagent, task)
    return subagent
  }

  async steer(id: number, text: string): Promise<boolean> {
    const subagent = this.subagents.get(id)
    if (!subagent || subagent.status !== 'running') return false
    await subagent.session.steer(text)
    return true
  }

  async abort(id: number): Promise<boolean> {
    const subagent = this.subagents.get(id)
    if (!subagent || subagent.status !== 'running') return false
    subagent.status = 'killed'
    subagent.message = '(Subagent killed.)'
    this.options.onStatusChange?.()
    await subagent.session.abort()
    return true
  }

  disposeAll(): void {
    const disposedSessions = new Set<AgentSession>()
    for (const subagent of this.subagents.values()) {
      if (subagent.status === 'running') {
        subagent.status = 'killed'
        subagent.message = '(Subagent disposed.)'
        this.options.onEnd?.(subagent)
      }
      if (!disposedSessions.has(subagent.session)) {
        subagent.session.dispose()
        disposedSessions.add(subagent.session)
      }
    }
    this.subagents.clear()
  }

  private subscribe(subagent: LiveSubagent): void {
    subagent.session.subscribe((event) => {
      switch (event.type) {
        case 'message_update':
          if (event.assistantMessageEvent.type === 'text_delta') {
            subagent.responseText = messageText(event.message)
          }
          break
        default:
          break
      }
    })
  }

  private async run(subagent: LiveSubagent, task: string): Promise<void> {
    try {
      await subagent.session.prompt(`Task: ${task}`)
      const lastMessage = lastMessageText(
        subagent.session.messages,
        MAX_SUBAGENT_OUTPUT_BYTES,
      )
      if (!lastMessage) {
        subagent.message = '(Subagent finished without a final message.)'
      } else {
        subagent.message = lastMessage
      }
      if (subagent.status === 'running') subagent.status = 'done'
    } catch (error) {
      if (subagent.status === 'running') {
        subagent.message =
          error instanceof Error ? error.message : String(error)
        subagent.status = 'failed'
      }
    } finally {
      subagent.completedAt = Date.now()
      subagent.responseText = undefined
      this.options.onStatusChange?.()
      this.options.onEnd?.(subagent)
    }
  }
}
