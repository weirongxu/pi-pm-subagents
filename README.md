# pi-modes

Two complementary modes for [pi](https://pi.dev): a read-only **plan** mode with a review step, and a **manager** mode where a read-only manager agent drives isolated worker agents.

## Plan mode

The agent becomes read-only (`edit`/`write` disabled, `bash` restricted to read-only commands) and produces a Markdown plan. When the plan is ready:

- A preview is shown above the editor.
- You're asked how to proceed:
  - **Execute directly** — restore full tools and run the plan in the current session (inherits pi's startup context).
  - **Execute via manager** — hand the plan to manager mode.
  - **Refine the plan** — give feedback and produce a revised plan.
  - **Cancel** — leave plan mode.

Toggle with `/plan [request]` or `Ctrl+Alt+P`. `/plan` with an argument enables plan mode and sends the request immediately.

## Manager mode

The current agent becomes a read-only **manager** (gets `prompts/manager.md` injected, cannot edit files) and drives isolated **worker** agents through the `delegate_worker` tool.

- The manager decomposes the plan and delegates each step.
- Each worker is an isolated in-process agent session with full tool access and its own context (it inherits the project's `AGENTS.md`/skills/env and your other extensions' tools, but not this conversation). The worker's loader drops this extension, so a worker can't re-enter plan/manager modes or spawn nested workers.
- A widget above the editor tracks every task: `☐ pending · ⏳ running · ✓ done · ✗ failed`.

Manager mode turns on automatically when you execute a plan "via manager". Leave it with `/manager`. When all delegated tasks finish, manager mode exits on its own and full tools are restored.

## Model configuration

`/modes-model` configures which model each role uses — `plan`, `manager`, and `worker`. Settings persist to `<agentDir>/modes-models.json` as `"provider/modelId"` references.

- `/modes-model` — pick a role, then pick a model interactively.
- `/modes-model worker anthropic/claude-sonnet-4-5` — set a role directly.
- `/modes-model manager off` — clear a role (it falls back to the session's current model).

Entering plan/manager mode switches the main session to that role's model and restores the previous model on exit. Workers always run with the configured worker model. Roles with no model set keep the session's current model.

## Customizing prompts

Each mode's prompt is a Markdown file under `prompts/` (`plan.md`, `manager.md`, `worker.md`). Drop a file with the same name under `<agentDir>/prompts/` to override the bundled one without editing the package.

To add extra rules without replacing the whole prompt, drop an append file under `<agentDir>/prompts/` (`plan-append.md`, `manager-append.md`, `worker-append.md`). Its content is concatenated after the base prompt (bundled or overridden).

## Install

```bash
pi install git:github.com/raidou/pi-modes     # adjust to your repo
```

Or load directly while developing:

```bash
pi -e ./extensions
```

## Layout

```
extensions/
  index.ts          # factory: state, commands, shortcut, bash gate, session restore
  plan.ts           # plan mode: review UI + execution dispatch
  manager.ts        # manager mode: delegate_worker tool, worker spawn, worker widget
  worker.ts         # worker session runner (inherits tools, isolated context; drops this extension via loader)
  models-config.ts  # /modes-model command + role model switch/restore
  helper.ts         # read-only gating, safe-bash check, shared state
prompts/
  plan.md           # injected while planning
  manager.md        # injected as the manager system prompt
  worker.md         # worker system prompt
```
