import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent'

import type { PmSubagentState, SubagentRecord } from '../types.js'
import { formatContextUsage, formatElapsed } from '../utils/format.js'
import { lastMessageText } from '../utils/messages.js'
import { FOLLOW_SYMBOL } from './consts.ts'
import {
  runInSubagentSpawnContext,
  SUBAGENT_SESSION_ID_PREFIX,
} from './identity.js'

const subagentDirFor = (cwd: string, agentDir: string): string => {
  const safeCwd = cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')
  return join(agentDir, 'sessions', 'pi-pm-subagents', `--${safeCwd}--`)
}

const MAX_SUBAGENT_OUTPUT_BYTES = 50 * 1024

export const MAX_REUSE_FOLLOWUPS = 50
export const MAX_CONCURRENCY_SUBAGENT = 5

export interface SpawnOptions {
  cwd: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  tools?: readonly string[]
  systemPrompt?: string
  role?: string
  onComplete?: (subagent: LiveSubagent, lastMessage: string) => Promise<void>
}

export interface LiveSubagent {
  record: SubagentRecord
  session: AgentSession
  onComplete?: (subagent: LiveSubagent, lastMessage: string) => Promise<void>
}

export type RestoreResult = 'restored' | 'already-live' | 'failed'

export interface RestoreOptions {
  systemPrompt?: string
  onComplete?: (subagent: LiveSubagent, lastMessage: string) => Promise<void>
}

export interface SubagentManagerOptions {
  state: PmSubagentState
  onStatusChange?: () => void
  onEachStart?: (subagent: LiveSubagent) => void
  onEachEnd?: (subagent: LiveSubagent) => void
}

export function formatSubagentSummary(
  subagent: LiveSubagent,
  titleWidth = 80,
): string {
  return [
    subagent.record.status,
    `#${subagent.record.id}`,
    subagent.record.title.slice(0, titleWidth),
    formatContextUsage(subagent.record.contextUsage),
    `${FOLLOW_SYMBOL} ${subagent.record.followUpCount}`,
    formatElapsed(subagent.record),
  ].join(' ')
}

export class SubagentManager {
  private subagents = new Map<number, LiveSubagent>()
  private disposed = false

  private isDisposed(): boolean {
    return this.disposed
  }

  constructor(private options: SubagentManagerOptions) {}

  private countRunning(): number {
    return [...this.subagents.values()].filter(
      (subagent) => subagent.record.status === 'running',
    ).length
  }

  list(): LiveSubagent[] {
    return [...this.subagents.values()]
  }

  get(id: number): LiveSubagent | undefined {
    return this.subagents.get(id)
  }

  private async createLoader(
    options: SpawnOptions,
  ): Promise<DefaultResourceLoader> {
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: getAgentDir(),
      systemPromptOverride: (base) => `${base}\n\n${options.systemPrompt}`,
    })
    await loader.reload()
    return loader
  }

  async createNewSubagent(
    title: string,
    prompt: string,
    options: SpawnOptions,
  ): Promise<LiveSubagent> {
    if (this.countRunning() >= MAX_CONCURRENCY_SUBAGENT) {
      throw new Error(
        `Subagent concurrency limit reached (${MAX_CONCURRENCY_SUBAGENT}). Wait for an existing subagent to finish, or abort one.`,
      )
    }
    const id = ++this.options.state.maxSubagentId
    const subagentSessionDir = subagentDirFor(options.cwd, getAgentDir())
    mkdirSync(subagentSessionDir, { recursive: true })
    const created = await runInSubagentSpawnContext(id, async () => {
      const loader = await this.createLoader(options)
      return createAgentSession({
        cwd: options.cwd,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        tools: options.tools ? [...options.tools] : undefined,
        resourceLoader: loader,
        sessionManager: SessionManager.create(options.cwd, subagentSessionDir, {
          id: `${SUBAGENT_SESSION_ID_PREFIX}${id}-${Date.now()}`,
        }),
      })
    })

    const sessionFile = created.session.sessionFile
    if (!sessionFile) throw new Error('Subagent session file is missing.')

    const record: SubagentRecord = {
      id,
      title,
      previousEntries: [],
      prompt,
      status: 'running',
      startedAt: Date.now(),
      followUpCount: 0,
      activeTools: options.tools ? [...options.tools] : [],
      role: options.role ?? 'worker',
      cwd: options.cwd,
      sessionFile,
    }
    const subagent: LiveSubagent = {
      record,
      session: created.session,
      onComplete: options.onComplete,
    }

    this.subagents.set(id, subagent)
    this.subscribe(subagent)
    this.options.onEachStart?.(subagent)
    this.options.onStatusChange?.()
    void this.run(subagent, prompt)
    return subagent
  }

  async restore(
    record: SubagentRecord,
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    if (this.isDisposed()) return 'failed'
    const live = this.subagents.get(record.id)
    if (live) {
      return live.record.sessionFile === record.sessionFile
        ? 'already-live'
        : 'failed'
    }
    if (!record.sessionFile) return 'failed'

    if (record.status === 'running') {
      record.status = 'killed'
      record.completedAt ??= Date.now()
    }

    let created: { session: AgentSession }
    try {
      created = await runInSubagentSpawnContext(record.id, async () => {
        const loader = await this.createLoader({
          cwd: record.cwd,
          systemPrompt: options.systemPrompt,
        })
        return createAgentSession({
          cwd: record.cwd,
          tools: [...record.activeTools],
          resourceLoader: loader,
          sessionManager: SessionManager.open(
            record.sessionFile,
            undefined,
            record.cwd,
          ),
        })
      })
      if (this.isDisposed()) {
        created.session.dispose()
        return 'failed'
      }
    } catch {
      return 'failed'
    }

    const subagent: LiveSubagent = {
      record,
      session: created.session,
      onComplete: options.onComplete,
    }
    this.subagents.set(record.id, subagent)
    this.subscribe(subagent)
    this.options.onStatusChange?.()
    return 'restored'
  }

  async followup(
    id: number,
    title: string,
    prompt: string,
  ): Promise<LiveSubagent> {
    const followupSubagent = this.subagents.get(id)
    if (!followupSubagent) throw new Error(`Subagent #${id} not found`)
    if (followupSubagent.record.followUpCount >= MAX_REUSE_FOLLOWUPS)
      throw new Error(
        `Subagent #${id} follow-up budget exhausted (${MAX_REUSE_FOLLOWUPS}/${MAX_REUSE_FOLLOWUPS}). Start a fresh subagent instead.`,
      )

    const record = followupSubagent.record
    const wasRunning = record.status === 'running'
    const prevStartedAt = record.startedAt
    record.previousEntries.unshift({
      title: record.title,
      status: wasRunning ? 'done' : record.status,
      followUpCount: record.followUpCount,
      contextUsage: record.contextUsage,
      startedAt: prevStartedAt,
      completedAt: wasRunning ? Date.now() : (record.completedAt ?? Date.now()),
    })
    record.title = title
    record.prompt = prompt
    record.followUpCount += 1

    if (record.status === 'running') {
      await followupSubagent.session.steer(prompt)
      this.options.onStatusChange?.()
      return followupSubagent
    }

    record.status = 'running'
    record.startedAt = Date.now()
    record.completedAt = undefined
    this.options.onStatusChange?.()
    this.options.onEachStart?.(followupSubagent)
    void this.run(followupSubagent, prompt)
    return followupSubagent
  }

  async steer(id: number, text: string): Promise<boolean> {
    const subagent = this.subagents.get(id)
    if (!subagent || subagent.record.status !== 'running') return false
    await subagent.session.steer(text)
    return true
  }

  async abort(id: number): Promise<boolean> {
    const subagent = this.subagents.get(id)
    if (!subagent || subagent.record.status !== 'running') return false
    subagent.record.status = 'killed'
    this.options.onStatusChange?.()
    await subagent.session.abort()
    return true
  }

  disposeAll(): void {
    this.disposed = true
    const disposedSessions = new Set<AgentSession>()
    for (const subagent of this.subagents.values()) {
      if (subagent.record.status === 'running') {
        subagent.record.status = 'killed'
        subagent.record.completedAt ??= Date.now()
        this.options.onEachEnd?.(subagent)
      }
      if (!disposedSessions.has(subagent.session)) {
        subagent.session.dispose()
        disposedSessions.add(subagent.session)
      }
    }
    this.subagents.clear()
  }

  private subscribe(subagent: LiveSubagent): void {
    subagent.record.contextUsage = subagent.session.getContextUsage()
    subagent.session.subscribe((event) => {
      if (event.type === 'message_end') {
        subagent.record.contextUsage = subagent.session.getContextUsage()
      }
    })
  }

  private async run(subagent: LiveSubagent, prompt: string): Promise<void> {
    let lastMessage: string | undefined
    try {
      await subagent.session.prompt(prompt)
      const finalText = lastMessageText(
        subagent.session.messages,
        MAX_SUBAGENT_OUTPUT_BYTES,
      )
      lastMessage = finalText ?? '(Subagent finished without a final message.)'
      if (subagent.record.status === 'running') subagent.record.status = 'done'
    } catch (error) {
      if (subagent.record.status === 'running') {
        lastMessage = error instanceof Error ? error.message : String(error)
        subagent.record.status = 'failed'
      }
    } finally {
      if (subagent.record.completedAt === undefined) {
        subagent.record.completedAt = Date.now()
        this.options.onStatusChange?.()
        await subagent.onComplete?.(subagent, lastMessage ?? '')
        this.options.onEachEnd?.(subagent)
      }
    }
  }
}
