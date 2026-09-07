# pi-pm-subagents

[pi](https://pi.dev) 的 pi-pm-subagents 扩展：

提供一个驱动子代理（subagents）的**协调者（coordinator）**模式。

## 安装

```bash
pi install @raidou/pi-pm-subagents
```

## 用法

进入协调者模式

`/pm` or `/coordinator`

或将其设为默认模式：

```
/pm-default or /coordinator-default
```

之后 agent 会派出若干子代理去工作并进行监督。

### 内置代理角色

- explorer
- researcher
- reviewer
- planner
- worker（默认内置角色）

**/plan <request>** 会（在协调者模式下）派出一个 planner 子代理，探索代码并产出计划。

## 配置

### 提示词（Prompts）

**Coordinator**

`~/.pi/agent/pm-subagents-prompts/coordinator.md`
`~/.pi/agent/pm-subagents-prompts/coordinator-append.md`

**Roles**

加载优先级（后者覆盖前者）：

1. 内置 `worker`
2. 插件 `agents/` 目录
3. 全局 `~/.pi/agent/agents`
4. 项目 `<cwd>/.pi/agents`

在 `pi-pm-subagents.json` 中设置 `"skipPluginAgents": true` 可跳过加载内置角色（包括 `planner`）。

### `pi-pm-subagents.json` 中的配置项

- `"subagentModel": "<model>"` — 默认子代理模型
- `"subagentModelScoped": ["<model>", ...]` — 子代理 scoped 模型池
- `"defaultMode": "coordinator"` — 启动时进入协调者模式（即 `/pm-default` 的持久化形式）

### 模型命令

**模型优先级（spawn 时）：** `role.model > session subagent model（初始值来自 pi-pm-subagents.json，可通过 /pm-subagent-model 或 Alt+N 覆盖） > ctx.model`

- **`/pm-subagent-model`** — 更改子代理模型
- **`/pm-subagent-scoped`** — 管理子代理 scoped 模型
  - `Alt+N` 在模型池中循环切换。池中可包含 `DEFAULT`（使用 pi 默认模型）标记。

## 注意

**终端/tmux 兼容性说明**：

> `Alt+N` 需要终端支持 Kitty keyboard protocol，
> 或在 tmux 中启用 `set -g extended-keys on`。
> 在标准 xterm 及类似终端中，`Alt+字母` 会以 ESC 序列发送，可能不可靠。

## 开发

```bash
PI_DEMO=1 pi
```

`/subagent-demo` 是用于开发的 UI fixture。仅在以 `PI_DEMO=1` 启动 pi 时才会注册：
