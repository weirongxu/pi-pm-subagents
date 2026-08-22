import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
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

import { formatElapsed } from '../utils/format.js'
import { lastMessageText, messageText } from '../utils/messages.js'

const SELF_DIR = fileURLToPath(new URL('../', import.meta.url))

const subagentDirFor = (cwd: string, agentDir: string): string => {
  const safeCwd = cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')
  return join(agentDir, 'sessions', 'pi-modes', `--${safeCwd}--`)
}

const MAX_SUBAGENT_OUTPUT_BYTES = 50 * 1024

export const MAX_REUSE_FOLLOWUPS = 10
export const MAX_CONCURRENCY_SUBAGENT = 5

export type SubagentStatus = 'running' | 'done' | 'failed' | 'killed'

export interface SpawnOptions {
  cwd: string
  model?: Model<Api>
  thinkingLevel?: ThinkingLevel
  tools?: readonly string[]
  systemPrompt?: string
  role?: string
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
  role: string
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
    `F(${subagent.followUpCount})`,
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
    const loader = await this.createLoader(options)
    const created = await createAgentSession({
      cwd: options.cwd,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      tools: options.tools ? [...options.tools] : undefined,
      resourceLoader: loader,
      sessionManager: SessionManager.create(options.cwd, subagentSessionDir, {
        id: `pi-modes-subagent-${id}-${Date.now()}`,
      }),
    })

    const enabledTools: Set<string> = options.tools
      ? new Set(options.tools)
      : new Set()
    const subagent: LiveSubagent = {
      id,
      title,
      text: prompt,
      status: 'running',
      session: created.session,
      startedAt: Date.now(),
      followUpCount: 0,
      enabledTools,
      role: options.role ?? 'worker',
    }

    this.subagents.set(id, subagent)
    this.subscribe(subagent)
    this.options.onStart?.(subagent)
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

    followupSubagent.title = title
    followupSubagent.text = prompt
    followupSubagent.followUpCount += 1

    if (followupSubagent.status === 'running') {
      await followupSubagent.session.steer(prompt)
      this.options.onStatusChange?.()
      return followupSubagent
    }

    followupSubagent.status = 'running'
    followupSubagent.startedAt = Date.now()
    followupSubagent.completedAt = undefined
    followupSubagent.message = undefined
    this.options.onStatusChange?.()
    this.options.onStart?.(followupSubagent)
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

  private async run(subagent: LiveSubagent, prompt: string): Promise<void> {
    try {
      await subagent.session.prompt(prompt)
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
