# pi-modes

pi-modes extension for [pi](https://pi.dev):

a **coordinator** mode that drives subagents.

## Coordinator mode

Let the agent delegate some subagents to work and supervise them.

## Planner subagent

**/plan <request>** delegates a planner subagent (in coordinator mode) that explores the code and produces a plan. The planner is a built-in role; override it via a `planner.md` in `<cwd>/.pi/agents/` or the global agents dir.

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

### `defaultMode`

When enabled, sessions that have no recorded mode yet (no last modes entry) automatically start in pm (coordinator) mode. Stored in `pi-modes.json`. Only `coordinator` is supported; any other value is ignored.

- **`/pm-default`** / **`/coordinator-default`** — Toggle pm (coordinator) mode enabled by default on startup

Sessions that already have a mode record keep it; an explicit exit within a session is not overridden.

### Shortcuts (coordinator mode)

- `Alt+N` — cycle forward to next model in scope, syncs to `subagentModel`

> **Terminal/tmux compatibility note**:
> `Alt+N` requires terminal support for Kitty keyboard protocol,
> or enable `set -g extended-keys on` in tmux.
> In standard xterm and similar terminals, `Alt+letter` is sent as an ESC sequence and may be unreliable.

## Customizing prompts

The coordinator prompt is a Markdown file under `<agentDir>/modes-prompts/` (`coordinator.md`).

To add extra rules without replacing the whole prompt, drop an append file under `<agentDir>/modes-prompts/` (`coordinator-append.md`).

## Install

```bash
pi install git:github.com/raidou/pi-modes     # adjust to your repo
```

## Demo commands

`/subagent-demo` is a UI fixture for development. It is only registered when pi is launched with `PI_DEMO=1`:

```bash
PI_DEMO=1 pi
```
