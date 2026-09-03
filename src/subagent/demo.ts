import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type {
  AgentSession,
  AgentSessionEventListener,
  ContextUsage,
  PromptOptions,
} from '@earendil-works/pi-coding-agent'

import type { LiveSubagent } from './manager.js'
import { SubagentManager } from './manager.js'

type MockAgentSession = Pick<
  AgentSession,
  'messages' | 'dispose' | 'abort' | 'steer' | 'subscribe' | 'prompt'
>

export class SubagentManagerDemo extends SubagentManager {
  readonly #subagents: LiveSubagent[] = initialDemoSubagents()

  override list(): LiveSubagent[] {
    return [...this.#subagents]
  }

  override get(id: number): LiveSubagent | undefined {
    return this.#subagents.find((w) => w.id === id)
  }

  override latest(): LiveSubagent | undefined {
    return this.#subagents[this.#subagents.length - 1]
  }

  override createNewSubagent(): Promise<LiveSubagent> {
    return Promise.reject(
      new Error('spawn is not supported for demo subagents'),
    )
  }

  override steer(): Promise<boolean> {
    return Promise.resolve(false)
  }

  override async abort(id: number): Promise<boolean> {
    const subagent = this.get(id)
    if (!subagent || subagent.status !== 'running') return false
    subagent.status = 'killed'
    subagent.completedAt = Date.now()
    return true
  }

  add(prompt?: string): void {
    this.#subagents.push({
      id: this.#subagents.length + 1,
      title: prompt ?? 'Review and fix authentication flow',
      previousEntries: [],
      prompt: prompt ?? 'Review and fix authentication flow',
      status: 'running',
      startedAt: Date.now() - 600000,
      completedAt: undefined,
      followUpCount: 0,
      enabledTools: new Set(['read', 'write', 'bash']),
      session: mockSessionFor('2'),
      role: 'worker',
      contextUsage: normalContextUsage(),
    })
  }
}

function initialDemoSubagents(): LiveSubagent[] {
  const now = Date.now()
  return [
    {
      id: 1,
      title: 'Review and fix authentication flow',
      previousEntries: [
        {
          title: 'Check JWT validation logic',
          status: 'done',
          followUpCount: 1,
          startedAt: now - 3500000,
          completedAt: now - 3000000,
        },
        {
          title: 'Initial authentication review',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 3600000,
          completedAt: now - 3500000,
        },
      ],
      prompt: 'Review and fix authentication flow',
      status: 'done',
      startedAt: now - 3000000,
      completedAt: now - 3000000,
      followUpCount: 2,
      enabledTools: new Set(['read', 'edit', 'bash']),
      session: mockSessionFor('1', 6),
      role: 'reviewer',
      contextUsage: normalContextUsage(),
    },
    {
      id: 2,
      title: 'Add unit tests for API endpoints',
      previousEntries: [],
      prompt: 'Add unit tests for API endpoints',
      status: 'running',
      startedAt: now - 600000,
      completedAt: undefined,
      followUpCount: 0,
      enabledTools: new Set(['read', 'write', 'bash']),
      session: mockSessionFor('2', 6),
      role: 'tester',
      contextUsage: normalContextUsage(),
    },
    {
      id: 3,
      title: 'Update dependencies and fix breaking changes\nClean local cache',
      previousEntries: [
        {
          title: 'Review React 19 compatibility',
          status: 'done',
          followUpCount: 1,
          startedAt: now - 1100000,
          completedAt: now - 900000,
        },
        {
          title: 'Check for outdated dependencies',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 1200000,
          completedAt: now - 1100000,
        },
      ],
      prompt: 'Update dependencies and fix breaking changes\nClean local cache',
      status: 'failed',
      startedAt: now - 900000,
      completedAt: now - 900000,
      followUpCount: 2,
      enabledTools: new Set(['read', 'bash']),
      session: mockSessionFor('3', 6),
      role: 'investigator',
      contextUsage: highContextUsage(),
    },
    {
      id: 4,
      title: 'Optimize database queries for dashboard',
      previousEntries: [
        {
          title: 'Analyze dashboard query performance',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 1700000,
          completedAt: now - 1500000,
        },
      ],
      prompt: 'Optimize database queries for dashboard',
      status: 'killed',
      startedAt: now - 1500000,
      completedAt: now - 1500000,
      followUpCount: 1,
      enabledTools: new Set(['read', 'edit']),
      session: mockSessionFor('4', 6),
      role: 'worker',
      contextUsage: unknownTokensContextUsage(),
    },
    {
      id: 5,
      title: 'Write documentation for new features',
      previousEntries: [],
      prompt: 'Write documentation for new features',
      status: 'done',
      startedAt: now - 7200000,
      completedAt: now - 6000000,
      followUpCount: 0,
      enabledTools: new Set(['read', 'write']),
      session: mockSessionFor('5', 6),
      role: 'docs',
    },
    {
      id: 6,
      title: 'Migrate legacy config parser to new schema',
      previousEntries: [],
      prompt: 'Migrate legacy config parser to new schema',
      status: 'running',
      startedAt: now - 95000000,
      completedAt: undefined,
      followUpCount: 0,
      enabledTools: new Set(['read', 'edit', 'bash']),
      session: mockSessionFor('6', 6),
      role: 'worker',
      contextUsage: nearFullContextUsage(),
    },
    {
      id: 7,
      title:
        'Investigate flaky integration test in CI pipeline for pull request validation workflow',
      previousEntries: [
        {
          title: 'Re-run failed CI workflow for logs',
          status: 'done',
          followUpCount: 2,
          startedAt: now - 900000,
          completedAt: now - 700000,
        },
        {
          title: 'Collect flaky test reports',
          status: 'done',
          followUpCount: 1,
          startedAt: now - 1000000,
          completedAt: now - 900000,
        },
      ],
      prompt:
        'Investigate flaky integration test in CI pipeline for pull request validation workflow',
      status: 'running',
      startedAt: now - 240000,
      completedAt: undefined,
      followUpCount: 3,
      enabledTools: new Set(['read', 'bash']),
      session: mockSessionFor('7', 6),
      role: 'investigator',
      contextUsage: normalContextUsage(),
    },
    {
      id: 8,
      title: 'Audit repository for hardcoded secrets',
      previousEntries: [
        {
          title: 'Check environment template files',
          status: 'done',
          followUpCount: 3,
          startedAt: now - 108000000,
          completedAt: now - 105000000,
        },
        {
          title: 'Scan git history for leaked keys',
          status: 'done',
          followUpCount: 2,
          startedAt: now - 110000000,
          completedAt: now - 108000000,
        },
        {
          title: 'Initial secrets audit',
          status: 'done',
          followUpCount: 1,
          startedAt: now - 110500000,
          completedAt: now - 110000000,
        },
      ],
      prompt: 'Audit repository for hardcoded secrets',
      status: 'done',
      startedAt: now - 105000000,
      completedAt: now - 96000000,
      followUpCount: 4,
      enabledTools: new Set(['read', 'bash']),
      session: mockSessionFor('8', 6),
      role: 'reviewer',
      contextUsage: highContextUsage(),
    },
    {
      id: 9,
      title: 'Verify release checklist for v2.4.0\nCheck changelog entries',
      previousEntries: [
        {
          title: 'Diff package version against tags',
          status: 'done',
          followUpCount: 0,
          startedAt: now - 60000,
          completedAt: now - 45000,
        },
      ],
      prompt: 'Verify release checklist for v2.4.0\nCheck changelog entries',
      status: 'failed',
      startedAt: now - 45000,
      completedAt: now - 30000,
      followUpCount: 1,
      enabledTools: new Set(['read', 'bash']),
      session: mockSessionFor('9', 6),
      role: 'tester',
      contextUsage: unknownTokensContextUsage(),
    },
  ]
}

function normalContextUsage(): ContextUsage {
  return { tokens: 60000, contextWindow: 200000, percent: 30.0 }
}

function highContextUsage(): ContextUsage {
  return { tokens: 160000, contextWindow: 200000, percent: 80.0 }
}

function unknownTokensContextUsage(): ContextUsage {
  return { tokens: null, contextWindow: 200000, percent: null }
}

function nearFullContextUsage(): ContextUsage {
  return { tokens: 187000, contextWindow: 200000, percent: 93.5 }
}

const MOCK_USAGE: Usage = {
  input: 1000,
  output: 500,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1500,
  cost: {
    input: 0.001,
    output: 0.002,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0.003,
  },
}

function userMessage(text: string): UserMessage {
  return {
    role: 'user',
    content: text,
    timestamp: Date.now(),
  }
}

function assistantMessage(
  text: string,
  toolCalls: ToolCall[] = [],
): AssistantMessage {
  const content: (TextContent | ToolCall)[] = [
    { type: 'text', text },
    ...toolCalls,
  ]
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    usage: MOCK_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function toolResultMessage(
  toolCallId: string,
  toolName: string,
  text: string,
  isError = false,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    isError,
    timestamp: Date.now(),
  }
}

function mockSessionFor(key: string, repeat: number = 1): AgentSession {
  const baseMessages = MOCK_MESSAGES[key]
  if (!baseMessages) {
    throw new Error(`Unknown mock key: ${key}`)
  }

  const messages: Message[] = []

  for (let r = 1; r <= repeat; r++) {
    let isFirstUserOfRound = true

    for (const msg of baseMessages) {
      if (msg.role === 'user') {
        const userContent =
          typeof msg.content === 'string' && isFirstUserOfRound && r > 1
            ? `${msg.content} (run ${r})`
            : msg.content
        const cloned: UserMessage = {
          role: 'user',
          content: userContent,
          timestamp: msg.timestamp,
        }
        messages.push(cloned)
        isFirstUserOfRound = false
      } else if (msg.role === 'assistant') {
        const content: (TextContent | ToolCall)[] = []
        for (const item of msg.content) {
          if (item.type === 'toolCall') {
            content.push({
              type: 'toolCall',
              id: r > 1 ? `${item.id}_r${r}` : item.id,
              name: item.name,
              arguments: item.arguments,
            })
          } else if (item.type === 'text') {
            content.push({ type: 'text', text: item.text })
          }
        }

        const cloned: AssistantMessage = {
          role: 'assistant',
          content,
          api: msg.api,
          provider: msg.provider,
          model: msg.model,
          usage: msg.usage,
          stopReason: msg.stopReason,
          timestamp: msg.timestamp,
        }
        messages.push(cloned)
      } else {
        const cloned: ToolResultMessage = {
          role: 'toolResult',
          toolCallId: r > 1 ? `${msg.toolCallId}_r${r}` : msg.toolCallId,
          toolName: msg.toolName,
          content: msg.content.map((block) => {
            if (block.type === 'text') {
              return { type: 'text' as const, text: block.text }
            }
            return {
              type: 'image' as const,
              data: block.data,
              mimeType: block.mimeType,
            }
          }),
          isError: msg.isError,
          timestamp: msg.timestamp,
        }
        messages.push(cloned)
      }
    }
  }

  const session: MockAgentSession = {
    messages,
    dispose: () => {},
    abort: async () => {},
    steer: async (_text: string, _images?: ImageContent[]) => {
      void _text
      void _images
    },
    subscribe: (_listener: AgentSessionEventListener) => {
      void _listener
      return () => {}
    },
    prompt: async (_text: string, _options?: PromptOptions) => {
      void _text
      void _options
    },
  }

  return session as AgentSession
}

const MOCK_MESSAGES: Record<string, Message[]> = {
  '1': [
    userMessage('Review and fix authentication flow'),
    assistantMessage(
      'Looking at the auth code to identify potential issues...',
    ),
    assistantMessage("I'll read the authentication module first.", [
      {
        type: 'toolCall',
        id: 'call_001',
        name: 'read',
        arguments: { path: 'src/auth/jwt.ts' },
      },
    ]),
    toolResultMessage(
      'call_001',
      'read',
      `export function validateToken(token: string): boolean {
  try {
    const decoded = jwt.verify(token, SECRET_KEY)
    return decoded.exp > Date.now() / 1000
  } catch (error) {
    console.error('Token validation failed:', error)
    return false
  }
}

// TODO: Add proper error types and logging`,
    ),
    assistantMessage(
      'Found the issue. The error handling needs improvement and the expiration check should be more explicit. Let me fix it.',
    ),
    assistantMessage('Fixed JWT token validation and updated error handling.'),
  ],
  '2': [
    userMessage('Add unit tests for API endpoints'),
    assistantMessage(
      "I'll write unit tests for the API endpoints. Let me check what's already covered.",
    ),
    assistantMessage(
      'Running the existing tests to see the current coverage.',
      [
        {
          type: 'toolCall',
          id: 'call_002',
          name: 'bash',
          arguments: {
            command: 'pnpm test -- --coverage',
          },
        },
      ],
    ),
    toolResultMessage(
      'call_002',
      'bash',
      `PASS src/api/user.test.ts
  User endpoints
    ✓ GET /api/users (45ms)
    ✓ POST /api/users (62ms)

Coverage Report:
-----------------
File                     | % Stmts | % Branch | % Funcs | % Lines
------------------------|---------|----------|---------|--------
src/api/user.ts         |   78.95 |    66.67 |     100 |   77.78
src/api/auth.ts         |   45.00 |        0 |      50 |   45.00
------------------------|---------|----------|---------|--------
All files               |   61.98 |    33.33 |      75 |   61.38`,
    ),
    assistantMessage(
      "Good coverage on user endpoints but auth tests are missing. I'll add those now...",
    ),
  ],
  '3': [
    userMessage('Update dependencies and fix breaking changes'),
    assistantMessage(
      "I'll update the dependencies to the latest versions and check for breaking changes.",
    ),
    assistantMessage('Running npm update...', [
      {
        type: 'toolCall',
        id: 'call_003',
        name: 'bash',
        arguments: {
          command: 'npm update',
        },
      },
    ]),
    toolResultMessage(
      'call_003',
      'bash',
      `npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR!
npm ERR! While resolving: pi-modes@1.0.0
npm ERR! Found: react@19.0.0
npm ERR! node_modules/react
npm ERR!   react@"^19.0.0" from the root project
npm ERR!
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^18.0.0" from some-library@2.5.0
npm ERR! node_modules/some-library
npm ERR!   some-library@"^2.5.0" from the root project
npm ERR!
npm ERR! Fix the upstream dependency conflict, or retry`,
      true,
    ),
    assistantMessage(
      "There's a peer dependency conflict with React 19. The library `some-library` requires React 18 but we're using React 19. We need to either downgrade React or find a compatible version of the library.",
    ),
  ],
  '4': [
    userMessage('Optimize database queries for dashboard'),
    assistantMessage(
      "I'll analyze the database queries used in the dashboard and optimize them for better performance.",
    ),
    assistantMessage(
      'Reading the query files to identify optimization opportunities.',
      [
        {
          type: 'toolCall',
          id: 'call_004',
          name: 'read',
          arguments: { path: 'src/queries/dashboard.sql' },
        },
      ],
    ),
    toolResultMessage(
      'call_004',
      'read',
      `-- Dashboard analytics query
SELECT 
  users.id,
  users.name,
  COUNT(sessions.id) as session_count,
  AVG(sessions.duration) as avg_duration
FROM users
LEFT JOIN sessions ON users.id = sessions.user_id
LEFT JOIN events ON sessions.id = events.session_id
WHERE users.created_at > NOW() - INTERVAL '30 days'
GROUP BY users.id
ORDER BY session_count DESC
LIMIT 100;`,
    ),
    assistantMessage(
      'I can see several optimization opportunities here. The query could benefit from proper indexing on user_id and created_at columns, and the LEFT JOIN with events is unnecessary for the current metrics. Let me create an optimized version...',
    ),
  ],
  '5': [
    userMessage('Write documentation for new features'),
    assistantMessage(
      "I'll write comprehensive documentation for the new features, including usage examples and API references.",
    ),
    assistantMessage('Creating the main README file.', [
      {
        type: 'toolCall',
        id: 'call_005',
        name: 'write',
        arguments: {
          path: 'docs/FEATURES.md',
          content: `# New Features

## Subagent Mode
Subagent mode allows you to delegate complex tasks to autonomous agents.

### Usage

\`\`\`typescript
const subagent = await subagentManager.spawn(
  'Analyze performance',
  'Profile the main loop and identify bottlenecks',
  { cwd: '/path/to/project' }
)
\`\`\`

### Features
- Async task execution
- Real-time progress tracking
- Automatic tool selection
- Error handling and retry

## API Reference

See [API.md](./API.md) for detailed documentation.
`,
        },
      },
    ]),
    toolResultMessage('call_005', 'write', 'OK'),
    assistantMessage(
      "Documentation written successfully. I've also updated the README with a quick start guide and added the API reference section.",
    ),
  ],
  '6': [
    userMessage('Migrate legacy config parser to new schema'),
    assistantMessage(
      "I'll port the legacy parser to the new schema while keeping backward compatibility.",
    ),
    assistantMessage('Reading the legacy parser implementation first.', [
      {
        type: 'toolCall',
        id: 'call_006',
        name: 'read',
        arguments: { path: 'src/config/legacy-parser.ts' },
      },
    ]),
    toolResultMessage(
      'call_006',
      'read',
      `export function parseLegacyConfig(raw: string): Config {
  const entries = raw.split(';').filter(Boolean)
  const config: Record<string, string> = {}
  for (const entry of entries) {
    const [key, value] = entry.split('=', 2)
    if (!key || value === undefined) continue
    config[key.trim()] = value.trim()
  }
  return config as Config
}`,
    ),
    assistantMessage(
      'The legacy parser accepts semicolon-separated key/value pairs and silently drops malformed entries. I will keep that behavior in the new schema loader and add a compatibility shim for old config files.',
    ),
  ],
  '7': [
    userMessage(
      'Investigate flaky integration test in CI pipeline for pull request validation workflow',
    ),
    assistantMessage(
      "I'll start from the failure logs of the most recent red CI runs.",
    ),
    assistantMessage('Fetching the failed run logs.', [
      {
        type: 'toolCall',
        id: 'call_007',
        name: 'bash',
        arguments: {
          command:
            'gh run list --status failure --limit 5 && gh run view --log-failed | tail -n 60',
        },
      },
    ]),
    toolResultMessage(
      'call_007',
      'bash',
      `integrations/webhook.test.ts > delivers PR validation event (2/10 runs failed)
Error: Test timed out after 30000ms
  at onWebhookReceived (integrations/webhook.test.ts:84:11)
  at Timeout.callback [as _onTimeout] (node:internal/timers:494:15)

Summary: 27 failed runs in the last 14 days, all in integrations/webhook.test.ts,
all timing out while waiting for the mock registry to answer.`,
    ),
    assistantMessage(
      'All recent failures are timeouts in integrations/webhook.test.ts while waiting for the mock webhook registry, which only warms up on a cold runner. Next I will add a readiness probe before the test asserts.',
    ),
  ],
  '8': [
    userMessage('Audit repository for hardcoded secrets'),
    assistantMessage(
      "I'll scan tracked files for common credential patterns and report findings.",
    ),
    assistantMessage('Running the pattern scan.', [
      {
        type: 'toolCall',
        id: 'call_008',
        name: 'bash',
        arguments: {
          command:
            "git ls-files | xargs grep -lniE '(api[_-]?key|secret|password)\\s*='",
        },
      },
    ]),
    toolResultMessage(
      'call_008',
      'bash',
      `test/fixtures/config.ts
docs/examples/quickstart.md
src/__tests__/auth.test.ts

grep: 3 files matched`,
    ),
    assistantMessage(
      'All three matches are test fixtures and documentation examples using placeholder values. No real credentials found — the audit is clean.',
    ),
  ],
  '9': [
    userMessage('Verify release checklist for v2.4.0'),
    assistantMessage(
      "I'll verify the release checklist items against the repository state.",
    ),
    assistantMessage('Checking the changelog for the 2.4.0 section.', [
      {
        type: 'toolCall',
        id: 'call_009',
        name: 'bash',
        arguments: {
          command: "grep -n '^## 2.4.0' CHANGELOG.md",
        },
      },
    ]),
    toolResultMessage(
      'call_009',
      'bash',
      'Error: Command failed with exit code 1\nNo CHANGELOG.md entry found for version 2.4.0',
      true,
    ),
    assistantMessage(
      'The release checklist check failed: CHANGELOG.md has no 2.4.0 section and package.json still reports 2.3.1. Both need to be updated before tagging the release.',
    ),
  ],
}
