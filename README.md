# pi-modes

pi-modes extension for [pi](https://pi.dev):

**plan** mode , and a **manager** mode.

## Plan mode

`/plan`

Let the agent write a plan; then you can review the plan and execute it directly or execute it in manager mode.

## Manager mode

Let the agent delegate some subagents to work and supervise them.

## Model configuration

`/modes-model` configures which model each role uses

## Customizing prompts

Each mode's prompt is a Markdown file under `<agentDir>/modes-prompts/` (`plan.md`, `manager.md`).

To add extra rules without replacing the whole prompt, drop an append file under `<agentDir>/modes-prompts/` (`plan-append.md`, `manager-append.md`).

## Install

```bash
pi install git:github.com/raidou/pi-modes     # adjust to your repo
```

## Demo commands

`/plan-demo` and `/workers-demo` are UI fixtures for development. They are only registered when pi is launched with `DEMO=1`:

```bash
DEMO=1 pi
```
