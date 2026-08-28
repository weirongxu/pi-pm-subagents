# pi-modes

pi-modes extension for [pi](https://pi.dev):

**plan** mode , and a **coordinator** mode.

## Plan mode

`/plan`

Let the agent write a plan; then you can review the plan and execute it directly or execute it in coordinator mode.

## Coordinator mode

Let the agent delegate some subagents to work and supervise them.

## Model configuration

**Model priority (spawn time):** `role.model > subagentModel > ctx.model`

### `subagentModel`

Single-element model for subagents. Stored in `pi-modes.json`.

- **`/modes-subagent-model`** — Select a model for subagents
- When set to `DEFAULT`, pi uses its built-in agent default model

### `subagentModelScoped`

Cycle pool of models. Stored in `pi-modes.json`. Can include `DEFAULT` marker.

- **`/modes-subagent-scoped`** — Manage the scope (multi-select UI with Space to toggle, Enter to save)

**`DEFAULT` marker:** When `DEFAULT` is selected, pi uses its built-in agent default model instead of a specific model reference.

### Shortcuts (coordinator mode)

- `Ctrl+Alt+P` — cycle forward to next model in scope, syncs to `subagentModel`
- `Ctrl+Shift+Alt+P` — cycle backward to previous model in scope, syncs to `subagentModel`

### Widget display

```
👥 COORDINATOR MODE - subagent: <model-ref> (i/n)
```

Shows `(i/n)` when scope is non-empty, where `i` is the index of current default in scope.

## Customizing prompts

Each mode's prompt is a Markdown file under `<agentDir>/modes-prompts/` (`plan.md`, `coordinator.md`).

To add extra rules without replacing the whole prompt, drop an append file under `<agentDir>/modes-prompts/` (`plan-append.md`, `coordinator-append.md`).

## Install

```bash
pi install git:github.com/raidou/pi-modes     # adjust to your repo
```

## Demo commands

`/plan-demo` and `/workers-demo` are UI fixtures for development. They are only registered when pi is launched with `DEMO=1`:

```bash
PI_DEMO=1 pi
```
