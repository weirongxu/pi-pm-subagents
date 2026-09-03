import { formatSubagentSummary, type LiveSubagent } from './manager.js'

export class MessageBatcher {
  private items: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly flush: (items: string[]) => void,
    private readonly windowMs = 3000,
  ) {}

  get pending(): readonly string[] {
    return [...this.items]
  }

  add(subagent: LiveSubagent, type: string, message: string): void {
    const tagName = type === 'done' ? 'subagent-done' : 'subagent-notify'
    const item = [
      `<${tagName}>`,
      `<type>${type}</type>`,
      `<job>${formatSubagentSummary(subagent)}</job>`,
      `<message>${message}</message>`,
      `</${tagName}>`,
    ].join('\n')
    this.items.push(item)
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.flushNow()
    }, this.windowMs)
  }

  flushNow(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.items.length === 0) return

    const items = this.items
    this.items = []
    this.flush(items)
  }

  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.items = []
  }
}
