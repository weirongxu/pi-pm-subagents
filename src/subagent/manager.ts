import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  type AgentSession,
  type ContextUsage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent'

import { formatContextUsage, formatElapsed } from '../utils/format.js'
import { lastMessageText } from '../utils/messages.js'
import { FOLLOW_SYMBOL } from './consts.ts'
import type { FleetEntryBase } from './fleet.js'
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

export type SubagentStatus = 'running' | 'done' | 'failed' | 'killed'

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
  id: number
  title: string
  previousEntries: FleetEntryBase[]
  prompt: string
  status: SubagentStatus
  session: AgentSession
  startedAt: number
  completedAt?: number
  followUpCount: number
  activeTools: string[]
  role: string
  contextUsage?: ContextUsage
  onComplete?: (subagent: LiveSubagent, lastMessage: string) => Promise<void>
}

export interface SubagentManagerOptions {
  onStatusChange?: () => void
  onEachStart?: (subagent: LiveSubagent) => void
  onEachEnd?: (subagent: LiveSubagent) => void
}

export function formatSubagentSummary(
  subagent: LiveSubagent,
  titleWidth = 80,
): string {
  return [
    subagent.status,
    `#${subagent.id}`,
    subagent.title.slice(0, titleWidth),
    formatContextUsage(subagent.contextUsage),
    `${FOLLOW_SYMBOL} ${subagent.followUpCount}`,
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
    this.seq += 1
    const id = this.seq
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

    const activeTools: string[] = options.tools ? [...options.tools] : []
    const subagent: LiveSubagent = {
      id,
      title,
      previousEntries: [],
      prompt,
      status: 'running',
      session: created.session,
      startedAt: Date.now(),
      followUpCount: 0,
      activeTools,
      role: options.role ?? 'worker',
      onComplete: options.onComplete,
    }

    this.subagents.set(id, subagent)
    this.subscribe(subagent)
    this.options.onEachStart?.(subagent)
    this.options.onStatusChange?.()
    void this.run(subagent, prompt)
    return subagent
  }

  async followup(
    id: number,
    title: string,
    prompt: string,
  ): Promise<LiveSubagent> {
    const followupSubagent = this.subagents.get(id)
    if (!followupSubagent) throw new Error(`Subagent #${id} not found`)
    if (followupSubagent.followUpCount >= MAX_REUSE_FOLLOWUPS)
      throw new Error(
        `Subagent #${id} follow-up budget exhausted (${MAX_REUSE_FOLLOWUPS}/${MAX_REUSE_FOLLOWUPS}). Start a fresh subagent instead.`,
      )

    const wasRunning = followupSubagent.status === 'running'
    const prevStartedAt = followupSubagent.startedAt
    followupSubagent.previousEntries.unshift({
      title: followupSubagent.title,
      status: wasRunning ? 'done' : followupSubagent.status,
      followUpCount: followupSubagent.followUpCount,
      startedAt: prevStartedAt,
      completedAt: wasRunning
        ? Date.now()
        : (followupSubagent.completedAt ?? Date.now()),
    })
    followupSubagent.title = title
    followupSubagent.prompt = prompt
    followupSubagent.followUpCount += 1

    if (followupSubagent.status === 'running') {
      await followupSubagent.session.steer(prompt)
      this.options.onStatusChange?.()
      return followupSubagent
    }

    followupSubagent.status = 'running'
    followupSubagent.startedAt = Date.now()
    followupSubagent.completedAt = undefined
    this.options.onStatusChange?.()
    this.options.onEachStart?.(followupSubagent)
    void this.run(followupSubagent, prompt)
    return followupSubagent
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
    this.options.onStatusChange?.()
    await subagent.session.abort()
    return true
  }

  disposeAll(): void {
    const disposedSessions = new Set<AgentSession>()
    for (const subagent of this.subagents.values()) {
      if (subagent.status === 'running') {
        subagent.status = 'killed'
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
    subagent.contextUsage = subagent.session.getContextUsage()
    subagent.session.subscribe((event) => {
      if (event.type === 'message_end') {
        subagent.contextUsage = subagent.session.getContextUsage()
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
      if (subagent.status === 'running') subagent.status = 'done'
    } catch (error) {
      if (subagent.status === 'running') {
        lastMessage = error instanceof Error ? error.message : String(error)
        subagent.status = 'failed'
      }
    } finally {
      subagent.completedAt = Date.now()
      this.options.onStatusChange?.()
      await subagent.onComplete?.(subagent, lastMessage ?? '')
      this.options.onEachEnd?.(subagent)
    }
  }
}
