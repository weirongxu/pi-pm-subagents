# pi-pm-subagents

pi-pm-subagents extension for [pi](https://pi.dev):

a **coordinator** mode that drives subagents.

## Installation

```bash
pi install @raidou/pi-pm-subagents
```

## Usage

Enter Coordinator mode

`/pm` or `/coordinator`

or enable it as the default:

```
/pm-default or /coordinator-default
```

Then the agent will delegate some subagents to work and supervise them.

### Built-in agent roles

- explorer
- researcher
- reviewer
- planner
- worker (default built-in role)

**/plan <request>** delegates a planner subagent (in coordinator mode) that explores the code and produces a plan.

## Configuration

### Prompts

**Coordinator**

`~/.pi/agent/pm-subagents-prompts/coordinator.md`
`~/.pi/agent/pm-subagents-prompts/coordinator-append.md`

**Roles**

Load precedence (later overrides earlier):

1. Built-in `worker`
2. Plugin `agents/` directory
3. Global `~/.pi/agent/agents`
4. Project `<cwd>/.pi/agents`

Set `"skipPluginAgents": true` in `pi-pm-subagents.json` to skip loading the built-in roles (including `planner`).

### Options in `pi-pm-subagents.json`

- `"subagentModel": "<model>"` — default subagent model
- `"subagentModelScoped": ["<model>", ...]` — subagent scoped model pool
- `"defaultMode": "coordinator"` — enter coordinator mode on startup (persistent equivalent of `/pm-default`)

### Model command

**Model priority (spawn time):** `role.model > session subagent model (initial value from pi-pm-subagents.json, can be overridden via /pm-subagent-model or Alt+N) > ctx.model`

- **`/pm-subagent-model`** — Change subagent model
- **`/pm-subagent-scoped`** — Manage the subagent scoped model
  - `Alt+N` Cycle pool of models. Can include `DEFAULT` (use pi default model) marker.

## Note

**Terminal/tmux compatibility note**:

> `Alt+N` requires terminal support for Kitty keyboard protocol,
> or enable `set -g extended-keys on` in tmux.
> In standard xterm and similar terminals, `Alt+letter` is sent as an ESC sequence and may be unreliable.

## Development

```bash
PI_DEMO=1 pi
```

`/subagent-demo` is a UI fixture for development. It is only registered when pi is launched with `PI_DEMO=1`.
